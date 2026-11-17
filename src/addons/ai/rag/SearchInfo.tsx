import { useRagSettings, ragReady } from './config';
import { isCloudEmbedding } from './embedApi';
import { useRagStatus } from './status';

/** One line under "Search my notes": how the search will work right now, and how it worked on the last question. */
export function SearchInfo({ howFound }: { howFound: string | null }) {
  const settings = useRagSettings((s) => s.settings);
  const status = useRagStatus();
  const ready = ragReady(settings);
  let text: string;
  if (!ready.ok) text = ready.reason === 'off' ? 'Searching by words. Search by meaning is off (Settings → Add-ons).' : 'Searching by words. Choose an embedding model in Settings to search by meaning.';
  else if (status.state === 'error') text = `Searching by words. Search by meaning stopped: ${status.error}`;
  else if (status.state === 'indexing') text = `Searching by words and meaning. Still indexing your notes: ${status.done} of ${status.total} passages.`;
  else if (status.total === 0) text = 'Searching by words and meaning.';
  else text = `Searching by words and meaning (${status.total} passages indexed).`;
  return (
    <p className="chat-searchinfo" role="status">
      {text}
      {ready.ok && isCloudEmbedding(settings.embed.source) ? ' Your question goes to the embedding service you chose.' : ''}
      {howFound ? ` ${howFound}` : ''}
    </p>
  );
}
