import { DocsUrlReplacer } from '@/components/docs/DocsUrlReplacer';

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DocsUrlReplacer />
      {children}
    </>
  );
}
