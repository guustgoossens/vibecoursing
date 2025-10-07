'use server';

import { headers as nextHeaders } from 'next/headers';
import { getWorkOS, saveSession } from '@workos-inc/authkit-nextjs';

type MagicIntent = 'signin' | 'signup';

export type FieldErrorKey = 'email' | 'code' | 'name' | 'terms';

export type AuthActionResult =
  | {
      ok: true;
      message?: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: Partial<Record<FieldErrorKey, string>>;
    };

export type MagicLinkRequestInput = {
  email: string;
  intent: MagicIntent;
};

export type MagicLinkVerifyInput = {
  email: string;
  code: string;
  intent: MagicIntent;
  name?: string;
};

const workos = getWorkOS();

type WorkOsConfig = {
  clientId: string;
  cookiePassword: string;
  redirectUri: string;
};

function getConfig(): WorkOsConfig {
  const clientId = process.env.WORKOS_CLIENT_ID;
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
  const redirectUri =
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? process.env.WORKOS_REDIRECT_URI ?? 'http://localhost:3000/callback';

  if (!clientId) {
    throw new Error('Missing required environment variable: WORKOS_CLIENT_ID');
  }

  if (!cookiePassword) {
    throw new Error('Missing required environment variable: WORKOS_COOKIE_PASSWORD');
  }

  return { clientId, cookiePassword, redirectUri };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function splitName(value: string): { firstName?: string; lastName?: string } {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return {};
  }
  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0] };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function emailIsValid(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

function codeIsValid(code: string) {
  return /^[0-9]{6}$/.test(code.trim());
}

async function resolveRequestUrl(): Promise<string> {
  const headers = await nextHeaders();
  const { redirectUri } = getConfig();
  return headers.get('referer') ?? headers.get('origin') ?? redirectUri;
}

function parseWorkOsError(error: unknown): { message: string; status?: number } {
  if (error && typeof error === 'object') {
    const maybe = error as { message?: string; status?: number; error?: string };
    const message = maybe.message ?? maybe.error;
    return {
      message: message ?? 'Something went wrong while talking to WorkOS.',
      status: maybe.status,
    };
  }

  return {
    message: 'Something went wrong while talking to WorkOS.',
  };
}

async function getRequestContext() {
  const headers = await nextHeaders();
  const ipAddress = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const userAgent = headers.get('user-agent') ?? undefined;
  return { ipAddress: ipAddress || undefined, userAgent };
}

export async function requestMagicLink(input: MagicLinkRequestInput): Promise<AuthActionResult> {
  const email = normalizeEmail(input.email ?? '');
  const fieldErrors: Partial<Record<FieldErrorKey, string>> = {};

  if (!email) {
    fieldErrors.email = 'Email is required';
  } else if (!emailIsValid(email)) {
    fieldErrors.email = 'Enter a valid email address';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields and try again.',
      fieldErrors,
    };
  }

  try {
    await workos.userManagement.createMagicAuth({
      email,
    });

    const defaultMessage =
      input.intent === 'signup'
        ? 'We sent you a 6-digit code to start your account.'
        : 'Check your inbox for a 6-digit code to continue.';

    return {
      ok: true,
      message: defaultMessage,
    };
  } catch (error) {
    const { message, status } = parseWorkOsError(error);

    if (status === 400 || status === 403) {
      return {
        ok: false,
        message:
          'Magic Auth is currently disabled for this project. Enable Magic Auth in the WorkOS dashboard to use one-time codes.',
      };
    }

    return {
      ok: false,
      message,
    };
  }
}

export async function verifyMagicCode(input: MagicLinkVerifyInput): Promise<AuthActionResult> {
  const email = normalizeEmail(input.email ?? '');
  const code = input.code?.trim() ?? '';
  const fieldErrors: Partial<Record<FieldErrorKey, string>> = {};

  if (!email) {
    fieldErrors.email = 'Email is required';
  } else if (!emailIsValid(email)) {
    fieldErrors.email = 'Enter a valid email address';
  }

  if (!code) {
    fieldErrors.code = 'Enter the code we emailed you';
  } else if (!codeIsValid(code)) {
    fieldErrors.code = 'Codes are 6 digits long';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields and try again.',
      fieldErrors,
    };
  }

  try {
    const { clientId, cookiePassword } = getConfig();
    const { ipAddress, userAgent } = await getRequestContext();

    const authResponse = await workos.userManagement.authenticateWithMagicAuth({
      clientId,
      email,
      code,
      ipAddress,
      userAgent,
      session: {
        sealSession: true,
        cookiePassword,
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[auth] authenticateWithMagicAuth payload size', JSON.stringify(authResponse).length);
      const sessionDetails =
        typeof authResponse === 'object' && authResponse && 'session' in authResponse
          ? (authResponse as { session?: unknown }).session
          : undefined;
      console.log(
        '[auth] authenticateWithMagicAuth session payload size',
        JSON.stringify(sessionDetails ?? {}).length,
      );
    }

    const sessionPayload = {
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
      user: authResponse.user,
      impersonator: authResponse.impersonator,
    } satisfies {
      accessToken: string;
      refreshToken: string;
      user: (typeof authResponse)['user'];
      impersonator?: (typeof authResponse)['impersonator'];
    };

    await saveSession(sessionPayload, await resolveRequestUrl());

    if (input.intent === 'signup' && input.name) {
      const { firstName, lastName } = splitName(input.name);
      if (firstName || lastName) {
        try {
          await workos.userManagement.updateUser({
            userId: authResponse.user.id,
            firstName,
            lastName,
          });
        } catch (updateError) {
          console.warn('Failed to update WorkOS user profile after sign-up:', updateError);
        }
      }
    }

    return {
      ok: true,
      message:
        input.intent === 'signup'
          ? 'Account created. Redirecting you to Vibecoursing…'
          : 'Signed in successfully. Redirecting…',
    };
  } catch (error) {
    const { message, status } = parseWorkOsError(error);

    if (status === 400 || status === 401) {
      return {
        ok: false,
        message: 'That code is invalid or has expired. Request a new one and try again.',
        fieldErrors: {
          code: 'Check the 6-digit code we emailed you',
        },
      };
    }

    return {
      ok: false,
      message,
    };
  }
}
