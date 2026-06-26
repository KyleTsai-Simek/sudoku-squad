import { PlayClient } from './play-client';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ daily?: string; dailyDifficulty?: string }>;
}

export default async function PlayPage({ params, searchParams }: Props) {
  const { code } = await params;
  const query = await searchParams;
  return (
    <PlayClient
      code={code}
      dailyDate={query.daily}
      dailyDifficulty={query.dailyDifficulty}
    />
  );
}
