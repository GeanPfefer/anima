import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkBudgetWaitProjection } from '@anima/core';
import { WorkBudgetWaitCard } from './WorkBudgetWaitCard';

const wait=(reason:WorkBudgetWaitProjection['reason']='user_attempt_budget_exhausted'):WorkBudgetWaitProjection=>({reason,reachedLimit:'attempts'});

describe('WorkBudgetWaitCard',()=>{
  beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,value:{outcome:'execution_completed'}})}) as jest.Mock;});

  test('declara a espera de orçamento como temporal, não como decisão humana',()=>{
    render(<WorkBudgetWaitCard wait={wait()} workItemId="item-1" expectedProposalVersion={2} onReload={jest.fn()}/>);
    expect(screen.getByRole('region',{name:'Aguardando janela de orçamento'})).toBeInTheDocument();
    expect(screen.getByText(/não exige nenhuma decisão sua/)).toBeInTheDocument();
    // Não há alternativas de decisão: só reverificar/retomar.
    expect(screen.queryByRole('button',{name:/Seguir|Encerrar/})).not.toBeInTheDocument();
  });

  test('reverificar retoma pelo supervisor com item e versão exatos',async()=>{
    const onReload=jest.fn();
    render(<WorkBudgetWaitCard wait={wait()} workItemId="item-1" expectedProposalVersion={2} onReload={onReload}/>);
    fireEvent.click(screen.getByRole('button',{name:'Reverificar orçamento e retomar'}));
    await waitFor(()=>expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/supervisor-turn',expect.objectContaining({
      method:'POST',
      body:JSON.stringify({workItemId:'item-1',expectedProposalVersion:2}),
    }));
    await waitFor(()=>expect(onReload).toHaveBeenCalled());
  });

  test('quando a janela ainda não liberou, é honesto e não finge progresso',async()=>{
    (global.fetch as jest.Mock).mockResolvedValueOnce({ok:true,json:async()=>({ok:true,value:{outcome:'no_eligible_work'}})});
    render(<WorkBudgetWaitCard wait={wait('interactive_reserve_protected')} workItemId="item-1" expectedProposalVersion={2} onReload={jest.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Reverificar orçamento e retomar'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent(/ainda não liberou/));
  });
});
