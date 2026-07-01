import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI App Builder',
  description: 'Open-source AI app builder',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
