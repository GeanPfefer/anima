import { render, screen, waitFor } from '@testing-library/react';
import { ChatClient } from './ChatClient';

jest.mock('next/navigation',()=>({useRouter:()=>({refresh:jest.fn()})}));
jest.mock('react-markdown',()=>({__esModule:true,default:({children}:{children:string})=><>{children}</>}));

describe('hidratação conversacional',()=>{
  beforeEach(()=>{global.fetch=jest.fn();Element.prototype.scrollIntoView=jest.fn();});
  afterEach(()=>jest.restoreAllMocks());

  test('bloqueia envio até reconstruir mensagens, cartões e foco persistidos',async()=>{
    let resolveHistory!:(value:{ok:boolean;json:()=>Promise<unknown>})=>void;
    (global.fetch as jest.Mock).mockImplementation((input:string)=>{
      const url=String(input);
      if(url==='/api/ai/history')return new Promise(resolve=>{resolveHistory=resolve;});
      return Promise.resolve({ok:true,json:async()=>({ok:true,value:null})});
    });
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    expect(screen.getByRole('textbox')).toBeDisabled();
    resolveHistory({ok:true,json:async()=>[]});
    await waitFor(()=>expect(screen.getByRole('textbox')).toBeEnabled());
  });

  test('falha de hidratação mantém o envio fechado e explica a lacuna',async()=>{
    (global.fetch as jest.Mock).mockImplementation((input:string)=>String(input)==='/api/ai/history'?Promise.reject(new Error('offline')):Promise.resolve({ok:true,json:async()=>({ok:true,value:null})}));
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    expect(await screen.findByText(/Não foi possível reconstruir a conversa persistida/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
