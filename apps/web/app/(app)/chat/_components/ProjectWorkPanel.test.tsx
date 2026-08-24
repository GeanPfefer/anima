import { fireEvent,render,screen } from '@testing-library/react';
import type { WorkPresentationView } from './WorkProposalCard';
import { ProjectWorkPanel } from './ProjectWorkPanel';

const make=(id:string,summary:string,dependencies:string[]=[])=>({item:{id,userId:'u',sourceMessageId:'source',state:'approved',impactLevel:'low',capability:'programming',originalRequest:'x',intent:{execution_spec:{schema_version:1,target:{kind:'project',reference:'G:/anima'},permissions:['read','write'],validation_criteria:[{label:'typecheck',command:'npm run typecheck'}],limits:{max_attempts:1,max_duration_minutes:30},depends_on_work_item_ids:dependencies}},proposal:{schemaVersion:1,data:{summary,objective:'obj',includedScope:['x'],excludedScope:['cloud'],expectedEffects:['x'],risks:[]}},proposalVersion:2,createdAt:'x',updatedAt:'x'},availableActions:['start'],latestResult:null,acceptedResult:null,latestEventType:'work_approved'}) as unknown as WorkPresentationView;

test('lista todos, explica dependências e só oferece execução autônoma ao elegível',()=>{
  const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',three='33333333-3333-4333-8333-333333333333';
  const items=[make(one,'Política local-first'),make(two,'Gate humano',[one]),make(three,'Auditoria',[two])];
  render(<ProjectWorkPanel items={items} focusedWorkItemId={null} onFocus={jest.fn()} onChange={jest.fn()}/>);
  expect(screen.getByText('Política local-first')).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Aguardando conclusão de ${one}`))).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Aguardando conclusão de ${two}`))).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button',{name:'Ver detalhes'})[0]!);
  expect(screen.getByRole('button',{name:'Executar autonomamente'})).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button',{name:'Ver detalhes'})[1]!);
  expect(screen.queryByRole('button',{name:'Executar autonomamente'})).not.toBeInTheDocument();
});
