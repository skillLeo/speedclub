/*
 * SPEED CLUB event map (M4.12, 09 §8.7, ADR-411 WebView fallback). One controller for both ways the app shows a map:
 *   - native: a WebView page loads maplibre-gl and this file, then calls SpeedclubEventMap.mount(…) (features/events/components/EventMap.tsx);
 *   - member web: the page loads both into the app's own document and mounts into a View's node (EventMap.web.tsx).
 * Served from the app's own origin (/app/map/event-map.js), so the web needs no inline script. Every colour, size and duration comes
 * from the app in `state` (design tokens); nothing here is a design value of its own.
 *
 * Modes: "pins" (EVT-01 Karte: clustered area points, a date label under each, the selected one in accent; SM19 pan to it), "snippet"
 * (EVT-02: the place or, for a private place, the area as a ring; not interactive), "picker" (EVT-03 Ort: a draggable pin).
 * Messages to the app: ready · error · select {id|null} · view {bbox} · pick {lat,lng}.
 */
(function (root) {
  'use strict';

  function featureCollection(pins) {
    return {
      type: 'FeatureCollection',
      features: (pins || []).map(function (pin) {
        return {
          type: 'Feature',
          id: pin.id,
          properties: { id: pin.id, label: pin.label || '', title: pin.title || '' },
          geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
        };
      }),
    };
  }

  function recolour(map, colors) {
    let layers = (map.getStyle() && map.getStyle().layers) || [];
    layers.forEach(function (layer) {
      try {
        if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', colors.canvas);
        else if (layer.id === 'water' || layer.id.indexOf('water') === 0) {
          if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', colors.water);
        }
      } catch {
        /* a layer without that property */
      }
    });
  }

  function mount(maplibregl, container, initial, send) {
    let state = initial;
    let marker = null;
    let ready = false;
    let lastBbox = '';

    let map = new maplibregl.Map({
      container: container,
      style: state.styleUrl,
      center: [state.center.lng, state.center.lat],
      zoom: state.zoom,
      attributionControl: false,
      interactive: state.mode !== 'snippet',
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      cooperativeGestures: false,
      fadeDuration: state.reduced ? 0 : state.fadeMs,
    });
    if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation();
    // 09 §8.7: the attribution is always visible, never collapsed.
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: state.attribution }), 'bottom-right');

    function emitView() {
      let b = map.getBounds();
      let bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(function (v) {
        return Math.round(v * 10000) / 10000;
      });
      let key = bbox.join(',');
      if (key === lastBbox) return;
      lastBbox = key;
      send({ type: 'view', bbox: bbox });
    }

    function pointPaint() {
      return [
        'case',
        ['==', ['get', 'id'], state.selectedId || ''],
        state.colors.accent,
        state.colors.primary,
      ];
    }

    function addPins() {
      map.addSource('events', {
        type: 'geojson',
        data: featureCollection(state.pins),
        cluster: true,
        clusterRadius: state.sizes.clusterRadius,
        clusterMaxZoom: state.sizes.clusterMaxZoom,
        promoteId: 'id',
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'events',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': state.colors.primary,
          'circle-radius': ['step', ['get', 'point_count'], state.sizes.cluster, 10, state.sizes.clusterL],
          'circle-stroke-color': state.colors.canvas,
          'circle-stroke-width': state.sizes.stroke,
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'events',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': [state.fonts.bold], 'text-size': state.sizes.text },
        paint: { 'text-color': state.colors.canvas },
      });
      map.addLayer({
        id: 'point',
        type: 'circle',
        source: 'events',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': pointPaint(),
          'circle-radius': state.sizes.pin,
          'circle-stroke-color': state.colors.canvas,
          'circle-stroke-width': state.sizes.stroke,
        },
      });
      map.addLayer({
        id: 'point-label',
        type: 'symbol',
        source: 'events',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': [state.fonts.regular],
          'text-size': state.sizes.text,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-allow-overlap': false,
        },
        paint: { 'text-color': state.colors.primary, 'text-halo-color': state.colors.canvas, 'text-halo-width': state.sizes.stroke },
      });
      map.on('click', 'clusters', function (event) {
        let feature = event.features && event.features[0];
        if (!feature) return;
        let source = map.getSource('events');
        let result = source.getClusterExpansionZoom(feature.properties.cluster_id);
        let go = function (zoom) {
          map.easeTo({ center: feature.geometry.coordinates, zoom: zoom, duration: state.reduced ? 0 : state.moveMs });
        };
        if (result && typeof result.then === 'function') result.then(go);
        else if (typeof result === 'number') go(result);
      });
      map.on('click', 'point', function (event) {
        let feature = event.features && event.features[0];
        if (!feature) return;
        event.originalEvent && (event.originalEvent.scClaimed = true);
        send({ type: 'select', id: String(feature.properties.id) });
      });
      map.on('click', function (event) {
        if (event.originalEvent && event.originalEvent.scClaimed) return;
        let hits = map.queryRenderedFeatures(event.point, { layers: ['point', 'clusters'] });
        if (hits.length === 0) send({ type: 'select', id: null });
      });
      ['clusters', 'point'].forEach(function (layer) {
        map.on('mouseenter', layer, function () {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, function () {
          map.getCanvas().style.cursor = '';
        });
      });
      map.on('moveend', emitView);
    }

    function addSnippet() {
      let data = featureCollection([{ id: 'place', lat: state.center.lat, lng: state.center.lng }]);
      map.addSource('place', { type: 'geojson', data: data });
      map.addLayer({
        id: 'place',
        type: 'circle',
        source: 'place',
        paint: state.exact
          ? { 'circle-color': state.colors.primary, 'circle-radius': state.sizes.pin, 'circle-stroke-color': state.colors.canvas, 'circle-stroke-width': state.sizes.stroke }
          : {
              'circle-color': state.colors.area,
              'circle-radius': state.sizes.area,
              'circle-stroke-color': state.colors.primary,
              'circle-stroke-width': state.sizes.hairline,
            },
      });
    }

    function placeMarker(lngLat) {
      if (!marker) {
        let dot = document.createElement('div');
        dot.setAttribute('aria-hidden', 'true');
        dot.style.width = state.sizes.handle + 'px';
        dot.style.height = state.sizes.handle + 'px';
        dot.style.borderRadius = '50%';
        dot.style.background = state.colors.primary;
        dot.style.border = state.sizes.stroke + 'px solid ' + state.colors.canvas;
        dot.style.cursor = 'grab';
        marker = new maplibregl.Marker({ element: dot, draggable: true }).setLngLat(lngLat).addTo(map);
        marker.on('dragend', function () {
          let p = marker.getLngLat();
          send({ type: 'pick', lat: p.lat, lng: p.lng });
        });
      } else {
        marker.setLngLat(lngLat);
      }
    }

    function addPicker() {
      if (state.picked) placeMarker([state.picked.lng, state.picked.lat]);
      map.on('click', function (event) {
        placeMarker(event.lngLat);
        send({ type: 'pick', lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
    }

    map.on('load', function () {
      recolour(map, state.colors);
      if (state.mode === 'pins') addPins();
      else if (state.mode === 'snippet') addSnippet();
      else addPicker();
      ready = true;
      send({ type: 'ready' });
      if (state.mode === 'pins') emitView();
    });
    map.on('error', function (event) {
      // A tile that failed is not a failed map; only a style or script failure before the first load is.
      if (!ready) send({ type: 'error', message: event && event.error ? String(event.error.message || event.error) : 'map' });
    });

    return {
      apply: function (next) {
        let previous = state;
        state = next;
        if (!ready) return;
        if (state.mode === 'pins') {
          let source = map.getSource('events');
          if (source && previous.pins !== next.pins) source.setData(featureCollection(state.pins));
          if (map.getLayer('point')) map.setPaintProperty('point', 'circle-color', pointPaint());
          // SM19: the selected pin comes into view on calm motion (a jump under reduced motion).
          if (state.selectedId && state.selectedId !== previous.selectedId && state.focus) {
            map.easeTo({ center: [state.focus.lng, state.focus.lat], duration: state.reduced ? 0 : state.moveMs });
          }
        }
        if (state.mode === 'picker' && state.picked) {
          placeMarker([state.picked.lng, state.picked.lat]);
          if (!previous.picked || previous.picked.lat !== state.picked.lat || previous.picked.lng !== state.picked.lng) {
            map.easeTo({ center: [state.picked.lng, state.picked.lat], zoom: Math.max(map.getZoom(), state.zoom), duration: state.reduced ? 0 : state.moveMs });
          }
        }
        if (previous.center.lat !== state.center.lat || previous.center.lng !== state.center.lng || previous.zoom !== state.zoom) {
          if (state.mode !== 'picker') map.jumpTo({ center: [state.center.lng, state.center.lat], zoom: state.zoom });
        }
      },
      resize: function () {
        map.resize();
      },
      destroy: function () {
        map.remove();
      },
    };
  }

  root.SpeedclubEventMap = { mount: mount, featureCollection: featureCollection };
})(typeof window !== 'undefined' ? window : this);
