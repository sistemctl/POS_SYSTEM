import { useRef } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

const layout = {
  default: [
    '1 2 3 4 5 6 7 8 9 0 {bksp}',
    'q w e r t y u i o p',
    'a s d f g h j k l ñ',
    '{shift} z x c v b n m - .',
    '{space} {enter}',
  ],
  shift: [
    '1 2 3 4 5 6 7 8 9 0 {bksp}',
    'Q W E R T Y U I O P',
    'A S D F G H J K L Ñ',
    '{shift} Z X C V B N M _ @',
    '{space} {enter}',
  ],
};

/** Teclado en pantalla para buscar y llenar formularios sin teclado físico. */
export function TecladoVirtual({
  valor,
  onChange,
  onEnter,
}: {
  valor: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
}) {
  const ref = useRef<any>(null);
  const shift = useRef(false);
  return (
    <Keyboard
      keyboardRef={(r) => (ref.current = r)}
      layout={layout}
      layoutName={shift.current ? 'shift' : 'default'}
      display={{ '{bksp}': '⌫', '{enter}': 'Aceptar', '{shift}': '⇧', '{space}': 'espacio' }}
      onKeyPress={(b) => {
        if (b === '{bksp}') onChange(valor.slice(0, -1));
        else if (b === '{enter}') onEnter?.();
        else if (b === '{space}') onChange(valor + ' ');
        else if (b === '{shift}') {
          shift.current = !shift.current;
          ref.current?.setOptions({ layoutName: shift.current ? 'shift' : 'default' });
        } else onChange(valor + b);
      }}
    />
  );
}
