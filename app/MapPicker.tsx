"use client";

/**
 * 地图点选目的地（多模态输入，可选）。
 *
 * 在地图上点击一个位置 → 反地理编码（BigDataCloud，免 key、支持 CORS，返回中文地名）
 * → 通过 onPick 回填到首页目的地输入框。用 Leaflet + 高德中文瓦片（与首页/行程地图一致）。
 * 高德是 GCJ-02 加偏坐标：落图中心须 wgs84→gcj02；点选读回的 e.latlng 是 GCJ-02，
 * 反查地名/回填前须 gcj02→wgs84 还原成真实坐标。用 divIcon 自绘标记避免默认图标 404。
 * 仅客户端加载（首页以 dynamic ssr:false 引入）。
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker, LeafletMouseEvent } from "leaflet";
import "leaflet/dist/leaflet.css";
import { wgs84ToGcj02, gcj02ToWgs84 } from "@/lib/gcj02";

/** 经纬度 → 中文地名（城市优先）；失败返回 null，绝不虚构 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  const city = d.city || d.locality || d.principalSubdivision || "";
  const parts = [city, d.countryName].filter(Boolean);
  return parts.length ? parts.join("，") : null;
}

export default function MapPicker({
  initial,
  onPick,
}: {
  /** 已填的目的地：用于初始化地图中心（前向地理编码，非必需） */
  initial?: string;
  onPick: (name: string, lat: number, lon: number) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // onPick 用 ref 持有，避免把它放进 init effect 依赖里导致重复建图
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapEl.current || mapRef.current) return;

      const map = L.map(mapEl.current, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: true,
      }).setView([35, 105], 4); // 默认落在中国范围（GCJ 偏移在 z4 属亚像素，无需转换）
      // 高德中文瓦片（scl=1 含区县/街道注记，style=7 标准电子图）；与首页/行程地图一致
      L.tileLayer(
        "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}",
        {
          subdomains: "1234",
          maxZoom: 18,
          className: "sc-tiles",
          attribution: '&copy; <a href="https://amap.com">高德地图</a>',
        },
      ).addTo(map);

      // 与行程地图一致的泪滴针脚（青瓷主色）
      const pin = L.divIcon({
        className: "",
        html: `<div class="tp-pin" style="--c:var(--teal)"><div class="tp-pin-inner"><span>✓</span></div></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 28],
      });

      map.on("click", async (e: LeafletMouseEvent) => {
        const { lat, lng } = e.latlng; // 高德画布坐标 = GCJ-02
        if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
        else markerRef.current = L.marker([lat, lng], { icon: pin }).addTo(map);
        // 还原真实坐标：反查地名/回填都用 WGS-84（针脚仍落在点击处 GCJ）
        const [wLat, wLon] = gcj02ToWgs84(lat, lng);
        setStatus("正在解析地名…");
        try {
          const name = await reverseGeocode(wLat, wLon);
          if (name) {
            setStatus(`已选：${name}`);
            onPickRef.current(name, wLat, wLon);
          } else {
            setStatus("未能解析该点地名，可换个点或手动填写。");
          }
        } catch {
          setStatus("解析失败，可换个点或手动填写。");
        }
      });

      mapRef.current = map;

      // 已填目的地 → 前向地理编码把地图移过去（尽力而为）
      const q = initial?.trim();
      if (q) {
        try {
          const res = await fetch("/api/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destination: q, origin: "", queries: [q] }),
          });
          const data = (await res.json()) as {
            center?: { lat: number; lon: number } | null;
            points?: Record<string, { lat: number; lon: number } | null>;
          };
          const p = data.center || data.points?.[q];
          if (p && mapRef.current && !disposed) {
            mapRef.current.setView(wgs84ToGcj02(p.lat, p.lon), 10);
          }
        } catch {
          // 忽略：定位中心只是便利，不影响点选
        }
      }
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 只建一次；initial 仅用于首次居中
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line shadow-soft">
      <div ref={mapEl} className="h-72 w-full bg-neutral-100" />
      <div className="border-t border-line px-3 py-2 text-xs text-muted">
        {status ?? "在地图上点击一个位置，自动填入目的地。"}
      </div>
    </div>
  );
}
