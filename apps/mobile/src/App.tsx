/**
 * apps/mobile — src/App.tsx
 *
 * Application root: RTL bootstrap, providers (auth), push init, sync on
 * launch, and the root navigator. Keeps no business logic — it wires
 * together the layers below it (ADR-001).
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, I18nManager, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "./hooks/useAuth";
import { RootNavigator } from "./navigation/RootNavigator";
import { initPush, ensurePushToken } from "./services/push";
import { syncNow } from "./lib/sync";

// RTL first: fa is the default locale. This must run before the first
// render; a full reload applies it on locale change (handled in Settings).
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

function Bootstrap({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initPush();
        // Best-effort: register the push token and run a sync pass.
        // Neither blocks the UI — failures are logged inside the services.
        ensurePushToken().catch(() => undefined);
        syncNow().catch(() => undefined);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#047857" />
      </View>
    );
  }
  return <>{children}</>;
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Bootstrap>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </Bootstrap>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
});
