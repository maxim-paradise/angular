import { Component, OnDestroy, OnInit } from "@angular/core";
import proj4 from "proj4";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [],
  template: ` <div id="map"></div> `,
  styles: [],
})
export class AppComponent implements OnInit, OnDestroy {
  
  private map?: any;
  
  private hexLayer?: any;
  
  private L?: any;
  
  private h3?: any;

  
  private readonly proj3857 = "EPSG:3857";
  private readonly proj4326 = "EPSG:4326";

  async ngOnInit(): Promise<void> {
    await this.initializeMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  private async initializeMap(): Promise<void> {
    
    if (typeof window === "undefined") {
      return;
    }
    
    const L = await import("leaflet");
    const h3 = await import("h3-js");
    this.L = L;
    this.h3 = h3;
    
    this.map = L.map("map", {
      zoomControl: true,
      preferCanvas: true,
    }).setView([23.8859, 45.0792], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(this.map);

    this.hexLayer = L.layerGroup().addTo(this.map);

    
    this.loadAndRender();

    
    this.map.on("zoomend moveend", () => this.loadAndRender());
  }

  private cachedRecords?: Array<{ lat: number; lng: number; color: string }>;

  private async loadAndRender(): Promise<void> {
    if (!this.map || !this.hexLayer) return;

    // Clear previous layers
    this.hexLayer.clearLayers();

    
    const zoom = this.map.getZoom();
    const resolution = this.zoomToH3Resolution(zoom);

    
    if (!this.cachedRecords) {
      const response = await fetch("data.json");
      const raw = await response.json();
      const features: any[] = raw.features ?? [];
      const records: Array<{ lat: number; lng: number; color: string }> = [];
      for (const feature of features) {
        const color = feature.properties?.COLOR_HEX
          ? `#${feature.properties.COLOR_HEX}`
          : "#999999";
        const geom = feature.geometry;
        if (!geom) continue;
        if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
          const polygons =
            geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
          for (const poly of polygons) {
            const outer: number[][] = poly[0];
            if (!outer || outer.length === 0) continue;
            
            const latLng: [number, number][] = outer.map(([x, y]) =>
              this.convert3857To4326([x, y])
            );
            const centroid = this.getRingCentroid(latLng);
            records.push({ lat: centroid[0], lng: centroid[1], color });
          }
        }
      }
      this.cachedRecords = records;
    }

    
    const L = this.L;
    if (!L) return;
    if (!this.h3) {
      this.h3 = await import("h3-js");
    }
    const bounds = this.map.getBounds();

    
    const cellToColor = new Map<string, string>();
    for (const rec of this.cachedRecords) {
      const cell = this.h3.latLngToCell(rec.lat, rec.lng, resolution);
      if (!cellToColor.has(cell)) {
        cellToColor.set(cell, rec.color);
      }
    }

    for (const [cell, color] of cellToColor.entries()) {
      const boundary = this.h3.cellToBoundary(cell, true) as Array<
        [number, number]
      >;
      const latLngs: [number, number][] = boundary.map(
        ([lng, lat]: [number, number]) => [lat, lng]
      );
      const hexBounds = L.latLngBounds(latLngs as any);
      if (!bounds.intersects(hexBounds)) continue;
      L.polygon(latLngs, {
        color: "#222",
        weight: 1,
        opacity: 0.8,
        fillColor: color,
        fillOpacity: 0.8,
      }).addTo(this.hexLayer);
    }
  }

  private zoomToH3Resolution(zoom: number): number {
    
    if (zoom <= 4) return 3;
    if (zoom <= 5) return 5;
    if (zoom <= 6) return 6;
    if (zoom <= 7) return 7;
    if (zoom <= 9) return 8;
    if (zoom <= 11) return 9;
    return 10;
  }

  private convert3857To4326([x, y]: [number, number]): [number, number] {
    // proj4 returns [lng, lat]
    const [lng, lat] = proj4(this.proj3857, this.proj4326, [x, y]);
    return [lat, lng];
  }

  private getRingCentroid(coords: [number, number][]): [number, number] {
    // Computes centroid for a ring defined as [lat, lng]
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [y1, x1] = coords[j];
      const [y2, x2] = coords[i];
      const f = x1 * y2 - x2 * y1;
      area += f;
      cx += (x1 + x2) * f;
      cy += (y1 + y2) * f;
    }
    area *= 0.5;
    if (area === 0) {
      // Fallback: average of points
      const avgLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const avgLng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      return [avgLat, avgLng];
    }
    return [cy / (6 * area), cx / (6 * area)];
  }
}
