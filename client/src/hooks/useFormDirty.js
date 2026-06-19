import { useEffect, useMemo, useRef } from 'react';

export function useFormDirty(value, activeKey) {
  const snapshotRef = useRef(null);

  useEffect(() => {
    if (!activeKey) {
      snapshotRef.current = null;
      return;
    }
    snapshotRef.current = JSON.stringify(value);
  }, [activeKey]);

  return useMemo(() => {
    if (!activeKey || snapshotRef.current === null) return false;
    try {
      return JSON.stringify(value) !== snapshotRef.current;
    } catch {
      return false;
    }
  }, [value, activeKey]);
}
