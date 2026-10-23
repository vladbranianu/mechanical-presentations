import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PRESENTATIONS } from '../presentations/catalog';

export function Home() {
  useEffect(() => {
    document.title = 'Mechanical Presentations';
  }, []);
  return (
    <main className="home">
      <header className="home-head">
        <div className="eyebrow">Prezentări tehnice 3D interactive</div>
        <h1>Mechanical Presentations</h1>
        <p>Mecanisme reale, secționate și puse în mișcare. Rotește, explodează, apasă pe piese.</p>
      </header>
      <ul className="grid">
        {PRESENTATIONS.map((p) => (
          <li key={p.slug}>
            <Link className="card" to={`/p/${p.slug}`} onMouseEnter={() => void p.load()} onFocus={() => void p.load()}>
              <img src={p.thumbnail} alt="" loading="lazy" width={1200} height={750} />
              <div className="card-body">
                <div className="eyebrow">{p.eyebrow}</div>
                <h2>{p.title}</h2>
                <p>{p.summary}</p>
                <div className="chips">
                  {p.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
