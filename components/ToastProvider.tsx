'use client';

import { Toaster } from 'react-hot-toast';

export function ToastProvider() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 5000,
        style: {
          background: 'hsl(30 35% 98%)',
          color: 'hsl(20 15% 15%)',
          border: '1px solid hsl(30 20% 88%)',
          borderRadius: '0.75rem',
          padding: '12px 16px',
          fontSize: '14px',
        },
        error: {
          duration: 6000,
          style: {
            background: 'hsl(0 85% 60% / 0.1)',
            border: '1px solid hsl(0 85% 60% / 0.3)',
          },
          iconTheme: {
            primary: 'hsl(0 85% 60%)',
            secondary: 'white',
          },
        },
        success: {
          style: {
            background: 'hsl(142 76% 36% / 0.1)',
            border: '1px solid hsl(142 76% 36% / 0.3)',
          },
        },
      }}
    />
  );
}
