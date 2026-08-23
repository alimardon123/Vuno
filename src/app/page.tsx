import { redirect } from 'next/navigation';

// Activity is the screen you open first: what needs you, ordered by urgency.
export default function Home() {
  redirect('/activity');
}
