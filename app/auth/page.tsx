'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AuthActionResult, FieldErrorKey } from './actions';
import { useAuth as useWorkOSAuth } from '@workos-inc/authkit-nextjs/components';
import { requestMagicLink, verifyMagicCode } from './actions';

type FlowStage = 'request' | 'verify';

type FormErrors = Partial<Record<FieldErrorKey, string>>;

type FormStatus = {
  tone: 'error' | 'success';
  message: string;
};

type SignInFormState = {
  email: string;
  code: string;
};

type SignUpFormState = {
  name: string;
  email: string;
  code: string;
  termsAccepted: boolean;
};

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <AuthPageInner />
    </Suspense>
  );
}

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { refreshAuth: refreshWorkOSAuth } = useWorkOSAuth();

  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>(
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin',
  );

  const [signInForm, setSignInForm] = useState<SignInFormState>({ email: '', code: '' });
  const [signInErrors, setSignInErrors] = useState<FormErrors>({});
  const [signInStatus, setSignInStatus] = useState<FormStatus | null>(null);
  const [signInStage, setSignInStage] = useState<FlowStage>('request');
  const [isProcessingSignIn, startSignInTransition] = useTransition();

  const [signUpForm, setSignUpForm] = useState<SignUpFormState>({
    name: '',
    email: '',
    code: '',
    termsAccepted: false,
  });
  const [signUpErrors, setSignUpErrors] = useState<FormErrors>({});
  const [signUpStatus, setSignUpStatus] = useState<FormStatus | null>(null);
  const [signUpStage, setSignUpStage] = useState<FlowStage>('request');
  const [isProcessingSignUp, startSignUpTransition] = useTransition();

  const signInFormRef = useRef<HTMLFormElement | null>(null);
  const signUpFormRef = useRef<HTMLFormElement | null>(null);

  // Keep tab in sync with ?mode URL param updates (e.g., direct links)
  useEffect(() => {
    const nextMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
    setActiveTab((current) => (current === nextMode ? current : nextMode));
  }, [searchParams]);

  // Reset form states whenever the active tab changes
  useEffect(() => {
    setSignInForm({ email: '', code: '' });
    setSignInErrors({});
    setSignInStatus(null);
    setSignInStage('request');

    setSignUpForm({ name: '', email: '', code: '', termsAccepted: false });
    setSignUpErrors({});
    setSignUpStatus(null);
    setSignUpStage('request');
  }, [activeTab]);

  const heroCopy = useMemo(() => {
    if (activeTab === 'signup') {
      return {
        heading: 'Welcome to Vibecoursing ✨',
        body: 'Chat-based journeys powered by Mistral. Start exploring in minutes.',
      };
    }
    return {
      heading: 'Welcome back to Vibecoursing ✨',
      body: 'Pick up your conversational learning journey with a magic link or SSO.',
    };
  }, [activeTab]);

  const heroFeatures = useMemo(() => {
    if (activeTab === 'signup') {
      return [
        {
          title: 'Conversational AI learning',
          description: 'Natural chats keep complex topics approachable and engaging.',
        },
        {
          title: 'Visual progress tracking',
          description: 'Watch phases, terms, and concepts evolve in real time.',
        },
        {
          title: 'Built for speed & simplicity',
          description: 'A modern stack delivers low-latency, curiosity-driven sessions.',
        },
      ];
    }
    return [
      {
        title: 'Curated plans',
        description: 'Hand-crafted study arcs tuned to your pace and curiosity.',
      },
      {
        title: 'Conversational tutoring',
        description: 'Scenario-based prompts keep you engaged and accountable.',
      },
      {
        title: 'Progress that sings',
        description: 'See each milestone and celebrate the journey, not just the destination.',
      },
    ];
  }, [activeTab]);

  const headerCopy = useMemo(() => {
    if (activeTab === 'signup') {
      return {
        title: 'Introducing Vibecoursing',
        subtitle: 'Curiosity-first learning with effortless onboarding.',
      };
    }
    return {
      title: 'Welcome back',
      subtitle: 'Sign in with a secure magic code or SSO.',
    };
  }, [activeTab]);

  const handleSignInSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSignInErrors({});
    setSignInStatus(null);

    if (signInStage === 'request') {
      startSignInTransition(async () => {
        const result = await requestMagicLink({
          email: signInForm.email,
          intent: 'signin',
        });
        handleRequestResult(result, {
          setErrors: setSignInErrors,
          setStatus: setSignInStatus,
          setStage: setSignInStage,
          resetCode: () => setSignInForm((form) => ({ ...form, code: '' })),
        });
      });
    } else {
      startSignInTransition(async () => {
        const result = await verifyMagicCode({
          email: signInForm.email,
          code: signInForm.code,
          intent: 'signin',
        });
        await handleVerifyResult(result, {
          setErrors: setSignInErrors,
          setStatus: setSignInStatus,
          router,
          refreshAuth: async () => {
            const refreshResult = await refreshWorkOSAuth({ ensureSignedIn: true });
            if (refreshResult && typeof refreshResult === 'object' && 'error' in refreshResult) {
              console.warn('WorkOS auth refresh reported an error', refreshResult.error);
            }
          },
          pathname,
        });
      });
    }
  };

  const handleSignUpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSignUpErrors({});
    setSignUpStatus(null);

    if (signUpStage === 'request') {
      const localErrors: FormErrors = {};
      if (!signUpForm.name.trim()) {
        localErrors.name = 'Add your name to personalize your journey.';
      }
      if (!signUpForm.termsAccepted) {
        localErrors.terms = 'Please accept the terms to keep going.';
      }
      if (!signUpForm.email.trim()) {
        localErrors.email = 'Email is required';
      }

      if (Object.keys(localErrors).length > 0) {
        setSignUpErrors(localErrors);
        setSignUpStatus({ tone: 'error', message: 'Please fix the highlighted fields and try again.' });
        return;
      }

      startSignUpTransition(async () => {
        const result = await requestMagicLink({
          email: signUpForm.email,
          intent: 'signup',
        });
        handleRequestResult(result, {
          setErrors: setSignUpErrors,
          setStatus: setSignUpStatus,
          setStage: setSignUpStage,
          resetCode: () => setSignUpForm((form) => ({ ...form, code: '' })),
        });
      });
    } else {
      startSignUpTransition(async () => {
        const result = await verifyMagicCode({
          email: signUpForm.email,
          code: signUpForm.code,
          intent: 'signup',
          name: signUpForm.name,
        });
        await handleVerifyResult(result, {
          setErrors: setSignUpErrors,
          setStatus: setSignUpStatus,
          router,
          refreshAuth: async () => {
            const refreshResult = await refreshWorkOSAuth({ ensureSignedIn: true });
            if (refreshResult && typeof refreshResult === 'object' && 'error' in refreshResult) {
              console.warn('WorkOS auth refresh reported an error', refreshResult.error);
            }
          },
          pathname,
        });
      });
    }
  };

  const resendSignInCode = () => {
    if (!signInForm.email) {
      setSignInErrors({ email: 'Enter your email address first' });
      return;
    }
    setSignInStatus(null);
    startSignInTransition(async () => {
      const result = await requestMagicLink({ email: signInForm.email, intent: 'signin' });
      handleResendResult(result, {
        setErrors: setSignInErrors,
        setStatus: setSignInStatus,
      });
    });
  };

  const resendSignUpCode = () => {
    if (!signUpForm.email) {
      setSignUpErrors({ email: 'Enter your email address first' });
      return;
    }
    setSignUpStatus(null);
    startSignUpTransition(async () => {
      const result = await requestMagicLink({ email: signUpForm.email, intent: 'signup' });
      handleResendResult(result, {
        setErrors: setSignUpErrors,
        setStatus: setSignUpStatus,
      });
    });
  };

  const switchTab = (tab: 'signin' | 'signup') => {
    setActiveTab(tab);
    router.replace(`/auth?mode=${tab}`, { scroll: false });
  };

  const inputClasses =
    'w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70';
  const labelClasses = 'text-sm font-medium text-foreground';
  const subtleText = 'text-sm text-muted-foreground';

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col overflow-hidden rounded-none bg-card shadow-xl lg:flex-row lg:rounded-3xl lg:border lg:border-border">
        <aside
          className="relative hidden flex-1 overflow-hidden lg:flex"
          style={{
            backgroundImage:
              'url("https://cdn.gamma.app/qujy11x86cm24lb/generated-images/XWhEkXyFocjew0YhjKkch.png")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-0 gradient-stripe opacity-30 mix-blend-overlay" />
          <div className="absolute inset-6 rounded-3xl border border-white/10 bg-white/10" />
          <div className="relative z-10 m-auto flex max-w-lg flex-col gap-4 p-12 text-primary-foreground">
            <span className="inline-flex w-fit items-center rounded-full bg-white/20 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-white/80 backdrop-blur">
              Curiosity-first learning
            </span>
            <h1 className="text-4xl font-semibold leading-tight drop-shadow-sm md:text-5xl">
              {heroCopy.heading}
            </h1>
            <p className="text-base leading-relaxed text-white/80">{heroCopy.body}</p>
            <div className="mt-8 grid gap-4 text-sm text-white/75">
              {heroFeatures.map((feature) => (
                <FeatureItem key={feature.title} title={feature.title} description={feature.description} />
              ))}
            </div>
          </div>
        </aside>

        <main className="flex w-full flex-1 items-center justify-center bg-background px-6 py-12 sm:px-10 lg:max-w-lg lg:px-12">
          <div className="w-full space-y-10">
            <header className="space-y-3 text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Vibecoursing
              </div>
              <div className="space-y-1">
                <h2 className="text-3xl font-semibold text-foreground">{headerCopy.title}</h2>
                <p className={subtleText}>{headerCopy.subtitle}</p>
              </div>
            </header>

            <div className="space-y-6">
              <nav className="grid grid-cols-2 rounded-full bg-muted p-1 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => switchTab('signin')}
                  className={`rounded-full px-4 py-2 transition ${
                    activeTab === 'signin'
                      ? 'bg-background text-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('signup')}
                  className={`rounded-full px-4 py-2 transition ${
                    activeTab === 'signup'
                      ? 'bg-background text-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sign Up
                </button>
              </nav>

              {activeTab === 'signin' ? (
                <form
                  ref={signInFormRef}
                  className="space-y-5"
                  onSubmit={handleSignInSubmit}
                  noValidate
                >
                  {signInStatus ? <FormBanner status={signInStatus} /> : null}
                  <div className="space-y-1.5">
                    <label className={labelClasses} htmlFor="signin-email">
                      Email
                    </label>
                    <input
                      id="signin-email"
                      type="email"
                      required
                      autoComplete="email"
                      disabled={signInStage === 'verify'}
                      className={`${inputClasses} ${signInErrors.email ? 'border-destructive ring-destructive/20' : ''}`}
                      value={signInForm.email}
                      onChange={(event) =>
                        setSignInForm((form) => ({
                          ...form,
                          email: event.target.value,
                        }))
                      }
                    />
                    {signInErrors.email ? <InputHint tone="error">{signInErrors.email}</InputHint> : null}
                  </div>

                  {signInStage === 'verify' ? (
                    <div className="space-y-2">
                      <label className={labelClasses} htmlFor="signin-code-0">
                        6-digit code
                      </label>
                      <VerificationCodeInput
                        namePrefix="signin-code"
                        value={signInForm.code}
                        disabled={isProcessingSignIn}
                        onChange={(code) =>
                          setSignInForm((form) => ({
                            ...form,
                            code,
                          }))
                        }
                        onComplete={() => {
                          if (!isProcessingSignIn) {
                            signInFormRef.current?.requestSubmit();
                          }
                        }}
                      />
                      {signInErrors.code ? (
                        <InputHint tone="error">{signInErrors.code}</InputHint>
                      ) : (
                        <InputHint tone="muted">Enter the 6-digit code we emailed you.</InputHint>
                      )}
                    </div>
                  ) : null}

                  {signInStage === 'request' ? (
                    <button
                      type="submit"
                      disabled={isProcessingSignIn}
                      className="w-full rounded-lg bg-gradient-to-r from-[hsl(var(--gradient-orange-2))] to-[hsl(var(--gradient-red-1))] px-4 py-2.5 text-base font-semibold text-primary-foreground shadow-lg shadow-[hsl(var(--gradient-orange-2))/25] transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isProcessingSignIn ? 'Sending code…' : 'Continue'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="submit"
                        disabled={isProcessingSignIn}
                        className="w-full rounded-lg bg-gradient-to-r from-[hsl(var(--gradient-orange-2))] to-[hsl(var(--gradient-red-1))] px-4 py-2.5 text-base font-semibold text-primary-foreground shadow-lg shadow-[hsl(var(--gradient-orange-2))/25] transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isProcessingSignIn ? 'Verifying…' : 'Verify & continue'}
                      </button>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => {
                            setSignInStage('request');
                            setSignInForm({ email: signInForm.email, code: '' });
                            setSignInStatus(null);
                            setSignInErrors({});
                          }}
                          className="font-medium text-primary hover:underline"
                        >
                          Use a different email
                        </button>
                        <button
                          type="button"
                          onClick={resendSignInCode}
                          disabled={isProcessingSignIn}
                          className="font-medium text-primary hover:underline disabled:opacity-60"
                        >
                          Resend code
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              ) : (
                <form
                  ref={signUpFormRef}
                  className="space-y-5"
                  onSubmit={handleSignUpSubmit}
                  noValidate
                >
                  {signUpStatus ? <FormBanner status={signUpStatus} /> : null}
                  <div className="space-y-1.5">
                    <label className={labelClasses} htmlFor="signup-name">
                      Full name
                    </label>
                    <input
                      id="signup-name"
                      type="text"
                      required
                      autoComplete="name"
                      disabled={signUpStage === 'verify'}
                      className={`${inputClasses} ${signUpErrors.name ? 'border-destructive ring-destructive/20' : ''}`}
                      value={signUpForm.name}
                      onChange={(event) =>
                        setSignUpForm((form) => ({
                          ...form,
                          name: event.target.value,
                        }))
                      }
                    />
                    {signUpErrors.name ? <InputHint tone="error">{signUpErrors.name}</InputHint> : null}
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelClasses} htmlFor="signup-email">
                      Email
                    </label>
                    <input
                      id="signup-email"
                      type="email"
                      required
                      autoComplete="email"
                      disabled={signUpStage === 'verify'}
                      className={`${inputClasses} ${signUpErrors.email ? 'border-destructive ring-destructive/20' : ''}`}
                      value={signUpForm.email}
                      onChange={(event) =>
                        setSignUpForm((form) => ({
                          ...form,
                          email: event.target.value,
                        }))
                      }
                    />
                    {signUpErrors.email ? <InputHint tone="error">{signUpErrors.email}</InputHint> : null}
                  </div>

                  {signUpStage === 'request' ? (
                    <label className="flex items-start gap-3 text-left text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={signUpForm.termsAccepted}
                        onChange={(event) =>
                          setSignUpForm((form) => ({
                            ...form,
                            termsAccepted: event.target.checked,
                          }))
                        }
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span>
                        I agree to the{' '}
                        <a href="/legal/terms" className="font-medium text-primary hover:underline">
                          Terms of Service
                        </a>{' '}
                        and{' '}
                        <a href="/legal/privacy" className="font-medium text-primary hover:underline">
                          Privacy Policy
                        </a>
                        .
                      </span>
                    </label>
                  ) : null}

                  {signUpStage === 'verify' ? (
                    <div className="space-y-2">
                      <label className={labelClasses} htmlFor="signup-code-0">
                        6-digit code
                      </label>
                      <VerificationCodeInput
                        namePrefix="signup-code"
                        value={signUpForm.code}
                        disabled={isProcessingSignUp}
                        onChange={(code) =>
                          setSignUpForm((form) => ({
                            ...form,
                            code,
                          }))
                        }
                        onComplete={() => {
                          if (!isProcessingSignUp) {
                            signUpFormRef.current?.requestSubmit();
                          }
                        }}
                      />
                      {signUpErrors.code ? (
                        <InputHint tone="error">{signUpErrors.code}</InputHint>
                      ) : (
                        <InputHint tone="muted">Enter the 6-digit code we emailed you.</InputHint>
                      )}
                    </div>
                  ) : null}

                  {signUpStage === 'request' ? (
                    <button
                      type="submit"
                      disabled={isProcessingSignUp}
                      className="w-full rounded-lg bg-gradient-to-r from-[hsl(var(--gradient-yellow))] via-[hsl(var(--gradient-orange-1))] to-[hsl(var(--gradient-red-1))] px-4 py-2.5 text-base font-semibold text-primary-foreground shadow-lg shadow-[hsl(var(--gradient-yellow))/20] transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isProcessingSignUp ? 'Sending code…' : 'Continue'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="submit"
                        disabled={isProcessingSignUp}
                        className="w-full rounded-lg bg-gradient-to-r from-[hsl(var(--gradient-yellow))] via-[hsl(var(--gradient-orange-1))] to-[hsl(var(--gradient-red-1))] px-4 py-2.5 text-base font-semibold text-primary-foreground shadow-lg shadow-[hsl(var(--gradient-yellow))/20] transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isProcessingSignUp ? 'Verifying…' : 'Verify & create account'}
                      </button>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => {
                            setSignUpStage('request');
                            setSignUpForm((form) => ({ ...form, code: '' }));
                            setSignUpStatus(null);
                            setSignUpErrors({});
                          }}
                          className="font-medium text-primary hover:underline"
                        >
                          Use a different email
                        </button>
                        <button
                          type="button"
                          onClick={resendSignUpCode}
                          disabled={isProcessingSignUp}
                          className="font-medium text-primary hover:underline disabled:opacity-60"
                        >
                          Resend code
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              )}
            </div>

            <footer className="text-center text-xs text-muted-foreground">
              By continuing you agree to our learning community guidelines and code of conduct.
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function AuthPageLoading() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col overflow-hidden rounded-none bg-card shadow-xl lg:flex-row lg:rounded-3xl lg:border lg:border-border">
        <div className="hidden flex-1 bg-muted lg:block" />
        <div className="flex w-full flex-1 items-center justify-center bg-background px-6 py-12 sm:px-10 lg:max-w-lg lg:px-12">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    </div>
  );
}

function handleRequestResult(
  result: AuthActionResult,
  {
    setErrors,
    setStatus,
    setStage,
    resetCode,
  }: {
    setErrors: (errors: FormErrors) => void;
    setStatus: (status: FormStatus | null) => void;
    setStage: (stage: FlowStage) => void;
    resetCode: () => void;
  },
) {
  if (result.ok) {
    setErrors({});
    resetCode();
    setStage('verify');
    setStatus({ tone: 'success', message: result.message ?? 'We just sent you a code.' });
    return;
  }

  if (result.fieldErrors) {
    setErrors(result.fieldErrors);
  }
  setStatus({ tone: 'error', message: result.message });
}

async function handleVerifyResult(
  result: AuthActionResult,
  {
    setErrors,
    setStatus,
    router,
    refreshAuth,
    pathname,
  }: {
    setErrors: (errors: FormErrors) => void;
    setStatus: (status: FormStatus | null) => void;
    router: ReturnType<typeof useRouter>;
    refreshAuth: () => Promise<void>;
    pathname: string | null;
  },
) {
  if (result.ok) {
    setErrors({});
    setStatus({ tone: 'success', message: result.message ?? 'Success! Redirecting…' });
    await refreshAuth();
    if (pathname === '/auth') {
      router.replace('/');
    } else {
      router.refresh();
    }
    return;
  }

  if (result.fieldErrors) {
    setErrors(result.fieldErrors);
  }
  setStatus({ tone: 'error', message: result.message });
}

function handleResendResult(
  result: AuthActionResult,
  {
    setErrors,
    setStatus,
  }: {
    setErrors: (errors: FormErrors) => void;
    setStatus: (status: FormStatus | null) => void;
  },
) {
  if (result.ok) {
    setErrors({});
    setStatus({ tone: 'success', message: result.message ?? 'We just sent you a new code.' });
    return;
  }

  if (result.fieldErrors) {
    setErrors(result.fieldErrors);
  }
  setStatus({ tone: 'error', message: result.message });
}

function InputHint({ children, tone }: { children: ReactNode; tone: 'error' | 'muted' }) {
  if (tone === 'error') {
    return <p className="text-sm font-medium text-destructive">{children}</p>;
  }
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function VerificationCodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  namePrefix,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: () => void;
  disabled?: boolean;
  namePrefix: string;
}) {
  const CODE_LENGTH = 6;
  const sanitizedValue = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
  const digits = useMemo(() => {
    return Array.from({ length: CODE_LENGTH }, (_, index) => sanitizedValue[index] ?? '');
  }, [sanitizedValue]);

  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (sanitizedValue !== value) {
      onChange(sanitizedValue);
    }
  }, [onChange, sanitizedValue, value]);

  const previousValueRef = useRef<string>(sanitizedValue);

  useEffect(() => {
    if (sanitizedValue.length === CODE_LENGTH && previousValueRef.current !== sanitizedValue) {
      onComplete?.();
    }
    previousValueRef.current = sanitizedValue;
  }, [onComplete, sanitizedValue]);

  const focusInput = (index: number) => {
    const clampedIndex = Math.min(Math.max(index, 0), CODE_LENGTH - 1);
    inputsRef.current[clampedIndex]?.focus();
    inputsRef.current[clampedIndex]?.select();
  };

  const updateValue = (nextDigits: string[]) => {
    const nextValue = nextDigits.join('');
    onChange(nextValue);
  };

  const handleChange = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const rawInput = event.target.value;
    const cleaned = rawInput.replace(/\D/g, '');
    const nextDigits = [...digits];

    if (!cleaned) {
      nextDigits[index] = '';
      updateValue(nextDigits);
      return;
    }

    cleaned.slice(0, CODE_LENGTH - index).split('').forEach((char, offset) => {
      nextDigits[index + offset] = char;
    });

    updateValue(nextDigits);

    const nextIndex = index + cleaned.length;
    if (nextIndex < CODE_LENGTH) {
      focusInput(nextIndex);
    }
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }
    if (event.key === 'Backspace') {
      const hasValue = digits[index]?.length;
      if (!hasValue && index > 0) {
        event.preventDefault();
        const nextDigits = [...digits];
        nextDigits[index - 1] = '';
        updateValue(nextDigits);
        focusInput(index - 1);
      }
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusInput(index - 1);
    }

    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      event.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) {
      return;
    }

    event.preventDefault();
    const nextDigits = Array.from({ length: CODE_LENGTH }, (_, index) => pasted[index] ?? '');
    updateValue(nextDigits);
    if (pasted.length < CODE_LENGTH) {
      focusInput(pasted.length);
    }
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          id={`${namePrefix}-${index}`}
          aria-label={`Digit ${index + 1}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onFocus={(event) => event.currentTarget.select()}
          className="h-12 w-12 rounded-xl border border-border bg-background text-center font-mono text-lg font-semibold tracking-[0.3em] text-foreground shadow-sm transition focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-70 sm:h-14 sm:w-14"
        />
      ))}
    </div>
  );
}

function FeatureItem({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
      <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70">{title}</h3>
      <p className="mt-2 text-sm text-white/80">{description}</p>
    </div>
  );
}

function FormBanner({ status }: { status: FormStatus }) {
  const toneClasses =
    status.tone === 'success'
      ? 'border border-emerald-500/50 bg-emerald-500/10 text-emerald-700'
      : 'border border-destructive/50 bg-destructive/10 text-destructive';

  return (
    <div className={`rounded-lg px-4 py-3 text-sm font-medium ${toneClasses}`}>{status.message}</div>
  );
}
