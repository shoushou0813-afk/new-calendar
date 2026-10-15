import { useEffect, useState } from 'react';
import { getCloudStatus, subscribeCloudStatus, type CloudStatus } from '../lib/cloud/cloudSync';

export function useCloudStatus(): CloudStatus {
  const [status, setStatus] = useState(getCloudStatus);
  useEffect(() => subscribeCloudStatus(setStatus), []);
  return status;
}
