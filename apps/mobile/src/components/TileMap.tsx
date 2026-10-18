/**
 * A small, static map view (OpenStreetMap data, tiles via our API): a 3×3 grid of tiles around a point with
 * a marker for the user. Plain <Image>s — no native map module.
 */
import React, { useMemo, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { TILE_SIZE, proxiedTileUrl, tileView } from '../services/mapTiles';
import { getApiBaseUrl } from '../services/api';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import { radius as radii } from '../theme/tokens';


interface Props {
  latitude: number;
  longitude: number;
  zoom?: number;
  height?: number;
  /** Marker colour (e.g. the area's safety colour). */
  color: string;
}

export default function TileMap({ latitude, longitude, zoom = 15, height = 240, color }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const view = useMemo(
    () =>
      width
        ? tileView(latitude, longitude, zoom, width, height, 1, (z, x, y) => proxiedTileUrl(getApiBaseUrl(), z, x, y))
        : null,
    [latitude, longitude, zoom, width, height],
  );

  return (
    <View
      onLayout={onLayout}
      style={[styles.root, { height, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      accessible
      accessibilityLabel={t('Map of your area')}
    >
      {view?.tiles.map((tile) => (
        <Image
          key={tile.key}
          source={{ uri: tile.url }}
          style={{ position: 'absolute', left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}
      {view && (
        <View pointerEvents="none" style={[styles.marker, { left: width / 2 - 9, top: height / 2 - 9, backgroundColor: color }]} />
      )}
      <View style={styles.attribution}>
        <Text style={styles.attributionText}>© OpenStreetMap contributors © CARTO</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', overflow: 'hidden', borderRadius: radii.lg, borderWidth: 1 },
  marker: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#fff',
  },
  attribution: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderTopLeftRadius: 4,
  },
  attributionText: { fontSize: 10, color: '#333' },
});
