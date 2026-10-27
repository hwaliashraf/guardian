import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Role } from '../navigation/RootNavigator';

interface Props {
  onSelectRole: (role: Role) => void;
}

export default function RoleSelectionScreen({ onSelectRole }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Who's using this device?</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => onSelectRole('parent')}
      >
        <Text style={styles.buttonText}>I'm a parent</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => onSelectRole('child')}
      >
        <Text style={styles.buttonText}>I'm on my child's device</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  button: { padding: 16, borderRadius: 8, backgroundColor: '#2f6fed', width: '100%' },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '500' },
});
