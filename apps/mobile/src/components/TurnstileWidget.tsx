/**
 * apps/mobile — src/components/TurnstileWidget.tsx
 *
 * Cloudflare Turnstile inside a WebView (C-02, ADR-0029). The widget
 * page is served inline with baseUrl set to the API origin so
 * Turnstile sees an allowed hostname context; the token returns via
 * window.ReactNativeWebView.postMessage. Renders nothing when no
 * site key is configured — the server remains the authority (403
 * captcha_failed when CAPTCHA is active and the token is missing).
 */
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { apiBaseUrl } from "../lib/config";

function originOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(url);
  return m ? m[0] : "https://localhost";
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string | null;
  onToken: (token: string | null) => void;
}): React.JSX.Element | null {
  const baseUrl = useMemo(() => originOf(apiBaseUrl()), []);
  const html = useMemo(() => {
    if (!siteKey) return "";
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:70px;background:transparent}</style>
</head><body>
<div class="cf-turnstile" data-sitekey="${siteKey}"
     data-callback="onTsOk" data-expired-callback="onTsGone" data-error-callback="onTsGone"></div>
<script>
function send(v){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(v || ""); }
function onTsOk(token){ send(token); }
function onTsGone(){ send(""); }
</script>
</body></html>`;
  }, [siteKey]);

  if (!siteKey) return null;

  const handleMessage = (e: WebViewMessageEvent): void => {
    const token = (e.nativeEvent.data || "").trim();
    onToken(token ? token : null);
  };

  return (
    <View style={styles.wrap}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl }}
        onMessage={handleMessage}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 78, marginVertical: 8 },
  webview: { backgroundColor: "transparent" },
});
