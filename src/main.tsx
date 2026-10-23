import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import './styles.css';

// Viewer + three.js live in their own chunk; the listing page never loads them.
const PresentationPage = lazy(() => import('./pages/PresentationPage'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="loading">Se încarcă…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/p/:slug" element={<PresentationPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);

function NotFound() {
  return (
    <main className="notfound">
      <h1>Pagina nu există</h1>
      <a href="/">Înapoi la prezentări</a>
    </main>
  );
}
