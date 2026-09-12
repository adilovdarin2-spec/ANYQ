// Копия базы, уехавшая с машины, на которой эта база живёт.
//
// Ни одной зависимости: подпись AWS Signature V4 — это четыре HMAC и один
// SHA-256, и написать их короче, чем объяснить, почему ради них в сборку
// приехало двадцать мегабайт SDK. Протокол выбран не из любви к Amazon:
// S3-совместимый интерфейс есть у всех, включая казахстанских провайдеров и
// MinIO, который можно поднять у себя, — то есть владелец не оказывается
// привязан к одному поставщику вместе со своими копиями.
//
// Что здесь намеренно не сделано: multipart. Он нужен файлам больше пяти
// гигабайт и заметно сложнее; дамп магазина — это мегабайты. Вместо того чтобы
// сделать наполовину, ниже стоит честный предел и внятный отказ.

import { createHash, createHmac } from 'node:crypto';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Больше этого одним запросом не отправить — дальше нужен multipart. */
export const MAX_SINGLE_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/**
 * Путь в канонический вид: каждый сегмент кодируется, косые черты остаются.
 *
 * `encodeURIComponent` пропускает `!'()*`, а S3 их кодирует, и подпись из-за
 * одного такого знака в имени файла не сойдётся. Имена дампов простые, но
 * префикс задаёт владелец, и ловить это в семь утра по ответу
 * «SignatureDoesNotMatch» — не то, ради чего пишут скрипты копирования.
 */
export function encodePath(path) {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/');
}

/** Строка запроса в каноническом виде: ключи отсортированы, всё закодировано. */
export function canonicalQuery(query) {
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [encodePath(key), encodeURIComponent(String(value))])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return parts.map(([k, v]) => `${k}=${v}`).join('&');
}

export function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Заголовок Authorization для одного запроса.
 *
 * Вынесено отдельной чистой функцией не ради красоты: подпись — единственное
 * место здесь, где ошибка не видна глазом. Ни один заголовок `x-amz-*` не
 * должен остаться неподписанным, иначе сервер ответит отказом, в котором не
 * будет сказано, каким именно.
 */
export function signRequest({
  method,
  host,
  path,
  query = {},
  headers = {},
  payloadSha256,
  accessKeyId,
  secretAccessKey,
  region,
  service = 's3',
  now = new Date(),
}) {
  const { amzDate, dateStamp } = amzDates(now);

  const all = {
    ...headers,
    host,
    'x-amz-content-sha256': payloadSha256,
    'x-amz-date': amzDate,
  };
  const named = Object.entries(all)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = named.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = named.map(([name]) => name).join(';');

  const canonicalRequest = [
    method,
    encodePath(path),
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: { ...all, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    canonicalRequest,
    stringToSign,
    signature,
  };
}

/** Ключи объектов из ответа ListObjectsV2. Разбор регулярками — ответ плоский. */
export function parseListing(xml) {
  const objects = [];
  for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    if (!key) continue;
    objects.push({
      key: decodeXml(key),
      size: Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0),
      lastModified: /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1] ?? '',
    });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { objects, truncated, next: next ? decodeXml(next) : null };
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Какие копии оставить, а какие удалить.
 *
 * Отдельной чистой функцией, потому что ошибиться здесь — значит удалить
 * лишнее, а это единственная операция во всём скрипте, которую нельзя
 * отменить. Сортировка по имени, а не по дате объекта: имя содержит отметку
 * времени по построению и не зависит от того, как поставщик округляет
 * LastModified.
 */
export function expired(keys, keep) {
  if (!Number.isFinite(keep) || keep <= 0) return [];
  const sorted = [...keys].sort();
  return sorted.slice(0, Math.max(sorted.length - keep, 0));
}

/**
 * Клиент для одного бакета.
 *
 * `pathStyle` по умолчанию: так работают MinIO, Cloudflare R2, Яндекс и
 * большинство совместимых. Для тех, кто требует адрес вида
 * `bucket.endpoint`, флаг выключается.
 */
export function createS3({
  endpoint,
  region = 'auto',
  bucket,
  accessKeyId,
  secretAccessKey,
  pathStyle = true,
  fetchImpl = fetch,
}) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3: нужны endpoint, bucket, accessKeyId и secretAccessKey');
  }

  const base = new URL(endpoint);
  const host = pathStyle ? base.host : `${bucket}.${base.host}`;
  const prefixPath = pathStyle ? `/${bucket}` : '';

  async function send({ method, key = '', query = {}, body = null, contentType }) {
    const payload = body ?? Buffer.alloc(0);
    const payloadSha256 = body ? sha256hex(payload) : EMPTY_SHA256;
    const path = `${prefixPath}/${key}`;

    const extra = {};
    if (contentType) extra['content-type'] = contentType;

    const { headers } = signRequest({
      method,
      host,
      path,
      query,
      headers: extra,
      payloadSha256,
      accessKeyId,
      secretAccessKey,
      region,
    });

    const search = canonicalQuery(query);
    const url = `${base.protocol}//${host}${encodePath(path)}${search ? `?${search}` : ''}`;
    const response = await fetchImpl(url, {
      method,
      headers,
      body: method === 'PUT' ? payload : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const code = /<Code>([\s\S]*?)<\/Code>/.exec(text)?.[1] ?? response.status;
      const message = /<Message>([\s\S]*?)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 200);
      throw new Error(`S3 ${method} ${key || '(список)'} → ${response.status} ${code}: ${message}`);
    }
    return response;
  }

  return {
    /** Кладёт объект целиком. Поток не годится: тело надо подписать. */
    async put(key, body, contentType = 'application/octet-stream') {
      if (body.byteLength > MAX_SINGLE_UPLOAD_BYTES) {
        throw new Error(
          `Дамп ${(body.byteLength / 1024 / 1024 / 1024).toFixed(2)} ГБ — больше, чем можно отправить одним запросом. ` +
            'Нужен multipart; пока его нет, снимайте копию на диск через --mirror.',
        );
      }
      await send({ method: 'PUT', key, body, contentType });
    },

    async get(key) {
      const res = await send({ method: 'GET', key });
      return Buffer.from(await res.arrayBuffer());
    },

    async remove(key) {
      await send({ method: 'DELETE', key });
    },

    /** Все объекты с этим префиксом, страница за страницей. */
    async list(prefix = '') {
      const found = [];
      let token = null;
      do {
        const res = await send({
          method: 'GET',
          query: { 'list-type': 2, prefix, 'max-keys': 1000, ...(token ? { 'continuation-token': token } : {}) },
        });
        const page = parseListing(await res.text());
        found.push(...page.objects);
        token = page.truncated ? page.next : null;
      } while (token);
      return found;
    },
  };
}
