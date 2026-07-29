import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HUMAN_INTERRUPTION_REASONS, type WorkDecisionProjection } from '@anima/core';
import { WorkDecisionCard } from './WorkDecisionCard';

const decision=(reason:WorkDecisionProjection['reason']='architectural_decision'):WorkDecisionProjection=>({
  requestEventId:'request-1',attemptId:'attempt-1',proposalVersion:2,reason,
  explanation:'Preciso escolher a fronteira antes de alterar o código.',
  checkpointReference:'checkpoint-1',
  options:[{id:'seguir',label:'Seguir com a alternativa A',effect:'resume'},{id:'encerrar',label:'Encerrar este trabalho',effect:'cancel'}],
});

describe('WorkDecisionCard',()=>{
  beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})}) as jest.Mock;});
  test.each(HUMAN_INTERRUPTION_REASONS)('apresenta a razão tipada %s',reason=>{
    render(<WorkDecisionCard decision={decision(reason)} workItemId="item-1" onReload={jest.fn()}/>);
    expect(screen.getByRole('region',{name:'Decisão necessária'})).toBeInTheDocument();
    expect(screen.getByText('Preciso escolher a fronteira antes de alterar o código.')).toBeInTheDocument();
  });
  test('envia somente a opção persistida e referencia pedido e versão exatos',async()=>{
    const onReload=jest.fn();
    render(<WorkDecisionCard decision={decision()} workItemId="item-1" onReload={onReload}/>);
    fireEvent.click(screen.getByRole('button',{name:'Seguir com a alternativa A'}));
    await waitFor(()=>expect(global.fetch).toHaveBeenCalled());
    const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body).toEqual({workItemId:'item-1',expectedProposalVersion:2,inputRequestedEventId:'request-1',optionId:'seguir'});
    await waitFor(()=>expect(onReload).toHaveBeenCalled());
  });
});
