import { StyleSheet, Text, View } from 'react-native';

// Stub — filled in by T21 (real pairing form calling usePairDevice).
export default function PairDeviceScreen() {
  return (
    <View style={styles.container}>
      <Text>Pair This Device (stub)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
