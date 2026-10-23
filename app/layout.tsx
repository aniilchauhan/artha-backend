import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Axion API',
  description: 'Axion Backend API Engine',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0a0a0a', color: '#ededed' }}>
        {children}
      </body>
    </html>
  );
}
