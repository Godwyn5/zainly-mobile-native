import {
  View, Text, StyleSheet, SafeAreaView, Pressable, StatusBar,
} from 'react-native';

const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN = '#163026';

export function LaunchErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <Text style={styles.title}>Impossible de charger ton espace</Text>
          <Text style={styles.description}>
            Vérifie ta connexion puis réessaie.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={onRetry}
          >
            <Text style={styles.btnText}>Réessayer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
  },
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: SPLASH_GREEN,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#7A746A',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
  },
  btn: {
    backgroundColor: SPLASH_GREEN,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
    color: SPLASH_BEIGE,
  },
});
