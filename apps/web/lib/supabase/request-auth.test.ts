jest.mock('./server', () => ({ createBearerClient: jest.fn(), createClient: jest.fn() }));
import { authenticateRequest, bearerToken } from './request-auth';
import { createBearerClient, createClient } from './server';

const bearerMock = createBearerClient as jest.Mock;
const cookieMock = createClient as jest.Mock;
const req = (authorization: string | null): Request => ({
  headers: { get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : null) },
} as unknown as Request);

beforeEach(() => jest.clearAllMocks());

describe('bearerToken', () => {
  test('extrai o token de um header Bearer (case-insensitive)', () => {
    expect(bearerToken({ get: () => 'Bearer abc.def' })).toBe('abc.def');
    expect(bearerToken({ get: () => 'bearer   xyz' })).toBe('xyz');
  });
  test('retorna null sem header ou sem token', () => {
    expect(bearerToken({ get: () => null })).toBeNull();
    expect(bearerToken({ get: () => 'Bearer ' })).toBeNull();
    expect(bearerToken({ get: () => 'Basic zzz' })).toBeNull();
  });
});

describe('authenticateRequest', () => {
  test('bearer válido autentica pelo token e NÃO usa o cliente por cookie', async () => {
    const client = { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-bearer' } }, error: null }) } };
    bearerMock.mockReturnValue(client);
    const result = await authenticateRequest(req('Bearer good.jwt'));
    expect(bearerMock).toHaveBeenCalledWith('good.jwt');
    expect(client.auth.getUser).toHaveBeenCalledWith('good.jwt');
    expect(result).toEqual({ client, userId: 'user-bearer' });
    expect(cookieMock).not.toHaveBeenCalled();
  });

  test('bearer inválido é recusado (null)', async () => {
    const client = { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }) } };
    bearerMock.mockReturnValue(client);
    expect(await authenticateRequest(req('Bearer bad.jwt'))).toBeNull();
  });

  test('sem bearer, cai no cliente por cookie', async () => {
    const client = { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-cookie' } } }) } };
    cookieMock.mockResolvedValue(client);
    const result = await authenticateRequest(req(null));
    expect(result).toEqual({ client, userId: 'user-cookie' });
    expect(bearerMock).not.toHaveBeenCalled();
  });

  test('cookie sem usuário é recusado (null)', async () => {
    cookieMock.mockResolvedValue({ auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) } });
    expect(await authenticateRequest(req(null))).toBeNull();
  });
});
