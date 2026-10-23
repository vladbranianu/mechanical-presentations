import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Viewer } from '../framework/Viewer';
import type { PresentationModule } from '../framework/types';
import { findPresentation } from '../presentations/catalog';

export default function PresentationPage() {
  const { slug } = useParams();
  const [search] = useSearchParams();
  const meta = findPresentation(slug);
  const [loaded, setLoaded] = useState<{ slug: string; module: PresentationModule<any> } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!meta) return;
    document.title = meta.title + ' · Mechanical Presentations';
    let alive = true;
    setError(false);
    meta
      .load()
      .then((m) => alive && setLoaded({ slug: meta.slug, module: m.default }))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [meta]);

  if (!meta)
    return (
      <main className="notfound">
        <h1>Prezentarea nu există</h1>
        <Link to="/">Înapoi la prezentări</Link>
      </main>
    );
  if (error) return <div className="loading">Prezentarea nu s-a putut încărca. Reîncarcă pagina.</div>;
  if (!loaded || loaded.slug !== meta.slug) return <div className="loading">Se încarcă {meta.title}…</div>;
  return <Viewer key={meta.slug} meta={meta} module={loaded.module} capture={search.has('capture')} />;
}
