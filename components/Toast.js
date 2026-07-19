'use client';
import { useEffect, useRef, useState } from 'react';
import { setToastListener } from '../lib/toast';

export default function Toast() {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setToastListener((m) => {
      setMsg(m);
      setVisible(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), 2600);
    });
  }, []);

  return <div className="toast" style={{ display: visible ? 'block' : 'none' }}>{msg}</div>;
}
