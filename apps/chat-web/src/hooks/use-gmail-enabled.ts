import { useEffect, useState } from 'react';
import { apiClient } from '../services/api-client';

/** Public capability, never inferred from login provider or stored credentials. */
export function useGmailEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    apiClient.getRuntime().then(data => { if (current) setEnabled(data.gmailEnabled === true); }).catch(() => {});
    return () => { current = false; };
  }, []);
  return enabled;
}

export function useMyCalendarEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    apiClient.getRuntime().then(data => { if (current) setEnabled(data.mycalendarEnabled === true); }).catch(() => {});
    return () => { current = false; };
  }, []);
  return enabled;
}

export function useMySheetsEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    apiClient.getRuntime().then(data => { if (current) setEnabled(data.mysheetsEnabled === true); }).catch(() => {});
    return () => { current = false; };
  }, []);
  return enabled;
}
