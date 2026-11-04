import { Button } from './Button';
export default { title: 'Components/Forms/Button', component: Button,
  argTypes: { size: { control: 'select', options: ['small','medium','large'], description: 'How large should the button be?' }, primary: { description: 'Is this the principal call to action?' } } };
export const Primary = { args: { primary: true, label: 'Button' } };
export const Secondary = { args: { label: 'Button' } };
export const Large = { args: { size: 'large', label: 'Button' } };
