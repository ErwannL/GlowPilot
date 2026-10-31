import { useEffect, useState } from 'react';

/** Re-renders every `ms` with the current time; used for live previews. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return now;
}

export function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept = '.json'): Promise<string> {
  return new Promise((resolve, reject) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = () => (i.files?.[0] ? i.files[0].text().then(resolve, reject) : reject(new Error('No file')));
    i.click();
  });
}
