'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function RateLimitIndicator() {
  const rateLimitStatus = useQuery(api.chat.getRateLimitStatus);

  if (!rateLimitStatus) {
    return null;
  }

  const { remaining, used, resetAt } = rateLimitStatus;
  const isLow = remaining <= 5;
  const isExhausted = remaining === 0;

  if (used === 0) {
    return null;
  }

  return (
    <span
      className={`text-xs ${
        isExhausted
          ? 'text-destructive'
          : isLow
            ? 'text-amber-600'
            : 'text-muted-foreground'
      }`}
    >
      {isExhausted ? (
        <>
          Daily limit reached
          {resetAt && (
            <span className="ml-1">
              (resets{' '}
              {new Date(resetAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              )
            </span>
          )}
        </>
      ) : (
        <>{remaining}/30 requests remaining</>
      )}
    </span>
  );
}
