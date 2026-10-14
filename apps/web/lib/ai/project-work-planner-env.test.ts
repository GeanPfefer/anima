/** @jest-environment node */
import { createConfiguredProjectPlanner } from './project-work-planner';

const injectedEnv = {
  ANIMA_PROJECT_PLANNER_PROVIDER: 'local',
  OLLAMA_URL: 'http://planner-env.invalid:1',
  ANIMA_PROJECT_PLANNER_MODEL: 'modelo-do-env-injetado',
};
const originalOllamaUrl = process.env.OLLAMA_URL;

afterEach(() => {
  jest.restoreAllMocks();
  if (originalOllamaUrl === undefined) {
    delete process.env.OLLAMA_URL;
  } else {
    process.env.OLLAMA_URL = originalOllamaUrl;
  }
});

async function captureRequest() {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'resposta simulada' }),
  } as Response);
  const planner = createConfiguredProjectPlanner(injectedEnv);
  await planner.proposeArguments('mensagem');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const call = fetchSpy.mock.calls[0];
  if (!call) throw new Error('A requisição esperada não foi capturada.');
  return call;
}

test('usa a URL do ambiente injetado na requisição local', async () => {
  const [url] = await captureRequest();
  expect(String(url).startsWith('http://planner-env.invalid:1')).toBe(true);
});

test('envia o modelo do ambiente injetado no corpo da requisição', async () => {
  const [, request] = await captureRequest();
  if (!request) throw new Error('O corpo da requisição não foi capturado.');
  const body: unknown = JSON.parse(String(request.body));
  expect(body).toEqual(expect.objectContaining({ model: 'modelo-do-env-injetado' }));
});

test('prioriza o host injetado sobre o host do ambiente do processo', async () => {
  process.env.OLLAMA_URL = 'http://processo-env.invalid:2';
  const [url] = await captureRequest();
  expect(String(url)).not.toContain('http://processo-env.invalid:2');
  expect(String(url).startsWith('http://planner-env.invalid:1')).toBe(true);
});
