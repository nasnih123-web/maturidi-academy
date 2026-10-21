import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { apiFetch } from "./api";

/**
 * Phase 2 — MFA (TOTP) lifecycle client for the Security page.
 *
 * All state/API logic lives here (ADR-001); pages/Security.tsx is
 * presentational. Backend contract (apps/api auth module):
 * - GET  /api/v1/auth/2fa/status             → {enabled, enrolled_at, recovery_codes_remaining}
 * - POST /api/v1/auth/2fa/setup              → {secret, provisioning_uri} (not stored yet)
 * - POST /api/v1/auth/2fa/enable             {secret, code} → {recovery_codes} (shown once)
 * - POST /api/v1/auth/2fa/disable            {password, code?|recovery_code?} (re-auth)
 * - POST /api/v1/auth/2fa/recovery/regenerate {password, code?|recovery_code?} → {recovery_codes}
 *
 * Recovery codes are only ever held in component state after enable /
 * regenerate — never persisted to storage by this module.
 */

export interface TwoFAStatus {
  enabled: boolean;
  enrolled_at: string | null;
  recovery_codes_remaining: number;
}

export interface TwoFASetup {
  secret: string;
  provisioning_uri: string;
}

/** Re-auth payload for sensitive 2FA operations: password + exactly one factor. */
export interface ReauthPayload {
  password: string;
  code?: string;
  recovery_code?: string;
}

export const TWOFA_STATUS_KEY = ["2fa-status"] as const;

export function useTwoFAStatus() {
  return useQuery({
    queryKey: TWOFA_STATUS_KEY,
    queryFn: () => apiFetch<TwoFAStatus>("/api/v1/auth/2fa/status"),
  });
}

export function useSetup2FA() {
  return useMutation({
    mutationFn: () =>
      apiFetch<TwoFASetup>("/api/v1/auth/2fa/setup", { method: "POST" }),
  });
}

export function useEnable2FA() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { secret: string; code: string }) =>
      apiFetch<{ recovery_codes: string[] }>("/api/v1/auth/2fa/enable", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TWOFA_STATUS_KEY });
    },
  });
}

export function useDisable2FA() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReauthPayload) =>
      apiFetch<{ message: string }>("/api/v1/auth/2fa/disable", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TWOFA_STATUS_KEY });
    },
  });
}

export function useRegenerateRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReauthPayload) =>
      apiFetch<{ recovery_codes: string[] }>(
        "/api/v1/auth/2fa/recovery/regenerate",
        { method: "POST", body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TWOFA_STATUS_KEY });
    },
  });
}

/** Render a provisioning URI as a QR data-URL (null while pending/on error). */
export function useQrDataUrl(uri: string | null): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!uri) {
      setUrl(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(uri, { width: 220, margin: 1 })
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [uri]);
  return url;
}

/** Plain-text rendering of recovery codes for copy/download (pure formatting). */
export function recoveryCodesText(codes: string[]): string {
  return codes.join("\n");
}

/** Trigger a one-time .txt download of the recovery codes. */
export function downloadRecoveryCodes(codes: string[]): void {
  const blob = new Blob([recoveryCodesText(codes) + "\n"], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "maturidi-recovery-codes.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
