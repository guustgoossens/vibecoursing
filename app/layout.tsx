import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from "@vercel/analytics/next"
import './globals.css';
import { ConvexClientProvider } from '@/components/ConvexClientProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vibecoursing.com'),
  title: 'Vibecoursing — AI-Guided Conversational Learning',
  description:
    'Vibecoursing pairs AI-generated lesson plans with a conversational tutor so learners can explore any topic, follow curated prompts, and track progress in real time.',
  keywords: [
    'AI learning platform',
    'conversational tutoring',
    'lesson planning',
    'Mistral AI',
    'WorkOS AuthKit',
  ],
  openGraph: {
    title: 'Vibecoursing — AI-Guided Conversational Learning',
    description:
      'Explore any topic with AI-generated lesson plans, guided chat prompts, and real-time progress tracking on Vibecoursing.',
    type: 'website',
    siteName: 'Vibecoursing',
    images: [
      {
        url: '/image.png',
        width: 565,
        height: 565,
        alt: 'Pixelated orange cat wearing a graduation cap',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vibecoursing — AI-Guided Conversational Learning',
    description:
      'AI-guided conversational learning plans, curated prompts, and progress tracking tailored to how you learn best.',
    images: ['/image.png'],
  },
  icons: {
    icon: {
      url: '/image.png',
      type: 'image/png',
      sizes: '565x565',
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
