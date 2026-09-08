import { useEffect, useState } from 'react';
import { ApiError, deleteDocumentPhoto, fetchDocumentPhotos, loadPhotoUrl, uploadDocumentPhoto } from '../api';
import type { DocumentPhoto } from '../api';
import { preparePhoto } from '../photo';

interface Props {
  token: string;
  documentId: string;
  /** Removing evidence is not a storeman's decision. */
  canDelete: boolean;
}

/**
 * The photograph of the paper a document came from.
 *
 * A delivery note is the only record of what the driver actually brought, and it
 * leaves with him. Every argument about a short delivery is an argument about a
 * document nobody has any more.
 */
export function DocumentPhotos({ token, documentId, canDelete }: Props) {
  const [photos, setPhotos] = useState<DocumentPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      try {
        const list = await fetchDocumentPhotos(token, documentId);
        if (cancelled) return;
        setPhotos(list);

        for (const photo of list) {
          const url = await loadPhotoUrl(token, photo.id);
          created.push(url);
          if (cancelled) return;
          setUrls((prev) => ({ ...prev, [photo.id]: url }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Не удалось загрузить фото');
      }
    })();

    return () => {
      cancelled = true;
      // Every object URL pins its blob in memory until it is revoked, and a
      // warehouse screen opened thirty times a day would hold thirty photos.
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [token, documentId]);

  async function add(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      const created = await uploadDocumentPhoto(token, documentId, prepared);
      const url = await loadPhotoUrl(token, created.id);
      setPhotos((prev) => [...prev, created]);
      setUrls((prev) => ({ ...prev, [created.id]: url }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось приложить фото');
    } finally {
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteDocumentPhoto(token, photoId);
      setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
      setUrls((prev) => {
        const url = prev[photoId];
        if (url) URL.revokeObjectURL(url);
        const { [photoId]: _gone, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить фото');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={`photo-${documentId}`}>Фото накладной</label>
      <input
        id={`photo-${documentId}`}
        type="file"
        accept="image/*"
        // Opens the camera straight away on a phone, which is what somebody
        // standing at the dock with the paper in their hand wants.
        capture="environment"
        disabled={busy}
        onChange={(e) => add(e.target.files?.[0])}
      />
      {error && <div className="login-error">{error}</div>}
      {busy && <span className="field-hint">Обрабатываем…</span>}

      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((photo) => (
            <div key={photo.id} className="photo-thumb">
              {urls[photo.id] ? (
                <a href={urls[photo.id]} target="_blank" rel="noreferrer">
                  <img src={urls[photo.id]} alt="Накладная" />
                </a>
              ) : (
                <span className="order-meta">загрузка…</span>
              )}
              {canDelete && (
                <button className="li-remove" disabled={busy} onClick={() => remove(photo.id)}>
                  Удалить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
