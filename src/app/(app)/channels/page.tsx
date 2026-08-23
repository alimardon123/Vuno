import { Empty } from '@/components/vuno/primitives';

export default function ChannelsIndex() {
  return (
    <main className="hidden min-w-0 flex-1 items-center justify-center md:flex">
      <Empty
        title="Pick a channel"
        hint="Members are users, teams or whole departments — and a user is a person or an agent, with no separate concept."
      />
    </main>
  );
}
