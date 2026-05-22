import { PlayClient } from './play-client';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function PlayPage({ params }: Props) {
  const { code } = await params;
  return <PlayClient code={code} />;
}
