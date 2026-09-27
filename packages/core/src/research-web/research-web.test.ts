import {
  buildResearchWebBrowserPolicy,
  classifyWebQuery,
  DEFAULT_RESEARCH_WEB_ENGINES,
  evaluateWebTarget,
  isPublicIpAddress,
  normalizeAllowedDomains,
  normalizeSearxngResponse,
  RESEARCH_WEB_BROWSER_ACTIONS,
  selectWebSource,
  webFindingCitation,
  type WebPageRefV1,
  type WebSearchResultV1,
} from './index';

describe('classifyWebQuery — privacidade antes de sair da máquina', () => {
  it('permite consulta pública', () => {
    expect(classifyWebQuery({ query: 'SearXNG search API json documentation' })).toEqual({
      queryClass: 'public',
      reasons: [],
      matchedProjectTerms: [],
    });
  });

  it('marca project_public quando cita identificador público do projeto', () => {
    const d = classifyWebQuery({ query: 'GeanPfefer/anima agent-browser wrapper', projectPublicTerms: ['GeanPfefer/anima'] });
    expect(d.queryClass).toBe('project_public');
    expect(d.matchedProjectTerms).toEqual(['GeanPfefer/anima']);
  });

  it.each([
    ['token github', 'why does ghp_abcdefghijklmnopqrstuvwxyz0123456789 fail', 'secret_pattern'],
    ['chave openai', 'sk-proj-ABCDEFGHIJKLMNOPQRSTUV rate limit', 'secret_pattern'],
    ['aws', 'AKIAIOSFODNN7EXAMPLE access denied', 'secret_pattern'],
    ['jwt', 'decode eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk', 'secret_pattern'],
    ['atribuição de segredo', 'error with password=hunter2', 'secret_pattern'],
    ['connection string', 'postgres://admin:s3cret@db.example.com/prod timeout', 'secret_pattern'],
    ['linha de .env', 'SUPABASE_SERVICE_ROLE_KEY=abc next build', 'env_assignment'],
    ['localhost', 'http://localhost:54321/rest/v1 returns 500', 'url_not_public'],
    ['ip privado', 'cannot reach 192.168.0.12 from container', 'private_ip'],
    ['metadata', 'curl 169.254.169.254 latest meta-data', 'private_ip'],
    ['file://', 'open file:///etc/passwd in chrome', 'url_not_public'],
    ['caminho local', 'error in C:\\Users\\Gean\\anima\\apps\\web\\lib\\x.ts', 'local_path'],
    ['stack trace', 'TypeError at run (/srv/app/worker.js:10:5)', 'stack_trace'],
    ['email', 'reset for someone@example.com', 'email_address'],
  ])('bloqueia %s', (_label, query, reason) => {
    const d = classifyWebQuery({ query });
    expect(d.queryClass).toBe('private_blocked');
    expect(d.reasons).toContain(reason);
  });

  it('bloqueia multilinha, vazio e excesso de tamanho', () => {
    expect(classifyWebQuery({ query: 'line one\nline two' }).reasons).toContain('multiline');
    expect(classifyWebQuery({ query: '   ' }).reasons).toContain('empty');
    expect(classifyWebQuery({ query: 'a '.repeat(200) }).reasons).toContain('too_long');
  });

  it('termo público do projeto não "libera" conteúdo sensível', () => {
    const d = classifyWebQuery({ query: 'anima token=abc123', projectPublicTerms: ['anima'] });
    expect(d.queryClass).toBe('private_blocked');
  });
});

describe('evaluateWebTarget / isPublicIpAddress', () => {
  it.each([
    ['https://docs.searxng.org/dev/search_api.html', true],
    ['http://arxiv.org/abs/1', true],
    ['http://localhost:3000/', false],
    ['http://127.0.0.1/', false],
    ['http://[::1]/', false],
    ['http://169.254.169.254/latest', false],
    ['http://10.0.0.5/', false],
    ['file:///C:/Users/x.txt', false],
    ['https://user:pass@example.com/', false],
    ['https://example.com:8443/', false],
    ['https://printer.local/', false],
    ['https://intranet/', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s → %s', (url, allowed) => {
    expect(evaluateWebTarget(url).allowed).toBe(allowed);
  });

  it('classifica endereços resolvidos', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPublicIpAddress(ip)).toBe(false);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::6810:84e5']) {
      expect(isPublicIpAddress(ip)).toBe(true);
    }
    expect(isPublicIpAddress('garbage')).toBe(false);
  });

  it('allowlist nunca aceita host local, IP ou rótulo único', () => {
    expect(normalizeAllowedDomains(['Docs.SearXNG.org', '*.github.com', 'localhost', '127.0.0.1', 'intranet', 'a.local', ''])).toEqual([
      'docs.searxng.org',
      '*.github.com',
    ]);
  });
});

describe('normalizeSearxngResponse', () => {
  const engines = ['google', 'brave'];

  it('normaliza JSON válido para o contrato', () => {
    const n = normalizeSearxngResponse(
      {
        results: [
          { title: ' Search  API ', url: 'https://docs.searxng.org/dev/search_api.html', content: 'curl …', engines: ['google', 'brave'], score: 4, publishedDate: null },
          { title: 'repo', url: 'https://github.com/searxng/searxng', content: 'x', engines: ['brave'], score: 1.5, publishedDate: '2026-09-25T10:00:00' },
        ],
        unresponsive_engines: [],
      },
      engines,
      10,
    );
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.results[0]).toEqual({
      rank: 1,
      title: 'Search API',
      url: 'https://docs.searxng.org/dev/search_api.html',
      snippet: 'curl …',
      engines: ['google', 'brave'],
      score: 4,
      publishedAt: null,
    });
    expect(n.results[1]?.publishedAt).toBe(new Date('2026-09-25T10:00:00').toISOString());
    expect(n.degraded).toEqual([]);
  });

  it('engine falhando vira degradação explícita', () => {
    const n = normalizeSearxngResponse(
      { results: [{ title: 't', url: 'https://a.example.org/', engines: ['google'] }], unresponsive_engines: [['brave', 'too many requests']] },
      engines,
      10,
    );
    expect(n.ok && n.degraded).toEqual([{ part: 'engine:brave', reason: 'too many requests' }]);
    expect(n.ok && n.respondedEngines).toEqual(['google']);
  });

  it('engine que não falha nem contribui é vazio silencioso (não é cobertura completa)', () => {
    const n = normalizeSearxngResponse({ results: [{ url: 'https://a.example.org/', engines: ['google'] }], unresponsive_engines: [] }, engines, 10);
    expect(n.ok && n.degraded).toEqual([{ part: 'engine:brave', reason: 'silent_empty' }]);
  });

  it('respeita o máximo de resultados, deduplica e descarta URL não-http', () => {
    const results = Array.from({ length: 30 }, (_, i) => ({ url: `https://s${i % 25}.example.org/`, engines: ['google', 'brave'] }));
    results.push({ url: 'javascript:alert(1)', engines: ['google'] });
    const n = normalizeSearxngResponse({ results }, engines, 5);
    expect(n.ok && n.results.map(r => r.rank)).toEqual([1, 2, 3, 4, 5]);
    const big = normalizeSearxngResponse({ results }, engines, 999);
    expect(big.ok && big.results.length).toBe(20);
  });

  it('corpo fora do formato falha em vez de inventar resultados', () => {
    expect(normalizeSearxngResponse('<html>', engines, 5).ok).toBe(false);
    expect(normalizeSearxngResponse({ error: 'No query' }, engines, 5).ok).toBe(false);
  });

  it('engines default da V1 são uma lista explícita sem as problemáticas', () => {
    expect(DEFAULT_RESEARCH_WEB_ENGINES).toEqual(['google', 'brave', 'github', 'stackoverflow', 'arxiv', 'docker hub']);
    for (const bad of ['bing', 'duckduckgo', 'qwant']) expect(DEFAULT_RESEARCH_WEB_ENGINES).not.toContain(bad);
  });
});

describe('selectWebSource', () => {
  const r = (rank: number, url: string): WebSearchResultV1 => ({ rank, title: url, url, snippet: '', engines: ['google'], score: null, publishedAt: null });
  const results = [
    r(1, 'https://www.reddit.com/r/selfhosted/x'),
    r(2, 'https://github.com/searxng/searxng'),
    r(3, 'https://docs.searxng.org/dev/search_api.html'),
    r(4, 'http://127.0.0.1:8888/search'),
  ];

  it('prefere documentação oficial e registra o motivo', () => {
    const s = selectWebSource(results, { officialDomains: ['docs.searxng.org'], upstreamRepos: ['searxng/searxng'] });
    expect(s?.result.url).toBe('https://docs.searxng.org/dev/search_api.html');
    expect(s?.tier).toBe('official_docs');
    expect(s?.reason).toContain('domínio oficial declarado');
  });

  it('cai para upstream, e só escolhe secundária quando permitido', () => {
    expect(selectWebSource(results, { upstreamRepos: ['searxng/searxng'] })?.tier).toBe('upstream_repo');
    expect(selectWebSource(results, {})).toBeNull();
    expect(selectWebSource(results, {}, { allowSecondary: true })?.result.rank).toBe(1);
  });

  it('nunca escolhe candidato que o browser não pode abrir', () => {
    expect(selectWebSource([r(1, 'http://127.0.0.1:8888/search')], { officialDomains: ['127.0.0.1'] }, { allowSecondary: true })).toBeNull();
  });
});

describe('política do browser e citação', () => {
  it('policy default-deny com nomes reais, sem evaluate/click/download/upload', () => {
    const p = buildResearchWebBrowserPolicy({ executablePath: 'agent-browser', version: '0.38.1', allowedDomains: ['docs.searxng.org', 'localhost'], timeoutMs: 30000, maxOutputChars: 20000 });
    expect(p.actions.default).toBe('deny');
    expect(p.actions.allow.length).toBeGreaterThan(0); // allow vazio = sem restrição no agent-browser
    expect(p.actions.allow).toContain('close'); // sem close a sessão não fecha
    for (const denied of ['evaluate', 'click', 'download', 'upload', 'cookies_get', 'screenshot']) {
      expect(RESEARCH_WEB_BROWSER_ACTIONS).not.toContain(denied);
    }
    expect(p.network.allowedDomains).toEqual(['docs.searxng.org']);
    expect(p.isolation).toEqual({ ephemeralSession: true, reuseSession: false, userProfile: false });
  });

  it('finding cita a página aberta, não o resultado de busca', () => {
    const pageRef: WebPageRefV1 = {
      schemaVersion: 1,
      requestedUrl: 'https://docs.searxng.org/dev/search_api.html',
      finalUrl: 'https://docs.searxng.org/dev/search_api.html',
      title: 'Search API',
      observedAt: '2026-09-27T20:00:00.000Z',
      sessionRef: 'anima-rw-1',
      extraction: 'readable_text',
      locator: null,
      contentHash: 'sha256:abc',
      blocked: false,
      artifactRef: null,
    };
    const citation = webFindingCitation({ claim: 'API aceita format=json', pageRef, fromSearch: { query: 'q', rank: 1, engines: ['google'] } });
    expect(citation).toEqual({ url: pageRef.finalUrl, contentHash: 'sha256:abc', observedAt: pageRef.observedAt });
  });
});
