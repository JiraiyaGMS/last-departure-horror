# Last Departure

Um jogo de terror em primeira pessoa que roda no navegador, em português do
Brasil e em inglês. ([Read in English](README.md).)

> Terminal Rodoviário de Grayhollow, 3 de novembro de 1987. Você adormeceu
> esperando num lugar onde nunca quis ficar. O último ônibus sai da
> Plataforma 9 às 3:33 da manhã, e você precisa de uma passagem válida. A
> rodoviária tem regras. Algumas são mentira.

Cada noite dura uns onze minutos. Seja pego, ou perca o ônibus, e você acorda
no mesmo banco às 11:47 da noite, com tudo o que aprendeu ainda no seu
caderno e nada nos bolsos. Há mais de uma saída.

Melhor jogado com fones de ouvido, no escuro.

## Idioma

O jogo inteiro está em **português do Brasil** e em **inglês**: menus,
placas, documentos, passageiros, avisos do alto-falante, caderno e finais.
Ele abre no idioma do navegador (um navegador em português abre em
português) e dá para trocar a qualquer momento: ENGLISH / PORTUGUÊS no canto
da tela inicial, ou Configurações → Idioma. A escolha fica salva com as
configurações. Num link, `?lang=pt` ou `?lang=en` no endereço escolhe o
idioma.

Trocar de idioma não apaga nada: o caderno é guardado em inglês e traduzido
na hora de mostrar.

## Controles

| Teclado e mouse | |
| --- | --- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, mouse | Andar, olhar |
| <kbd>E</kbd> | Usar, pegar, esconder-se, ler |
| <kbd>Tab</kbd> | Caderno, com a lista desta noite |
| <kbd>M</kbd> | O mapa da rodoviária, no caderno |
| <kbd>C</kbd> | Agachar (segurar, ou alternar nas Configurações) |
| <kbd>Shift</kbd> | Correr, contra as regras |
| <kbd>F</kbd> / <kbd>B</kbd> | Lanterna / pilha nova |
| <kbd>G</kbd> | Jogar uma moeda |
| <kbd>R</kbd> | Mostrar a passagem, ou responder |
| <kbd>Espaço</kbd> / <kbd>Q</kbd> | Prender o fôlego / sair, no esconderijo |
| <kbd>Esc</kbd> | Pausar |

Com um controle: o analógico esquerdo anda, o direito olha, <kbd>A</kbd> usa,
<kbd>B</kbd> volta (ou agacha), <kbd>X</kbd> lanterna, <kbd>Y</kbd>
passagem, <kbd>LB</kbd>/<kbd>RB</kbd> moeda e pilha, <kbd>LT</kbd> prende o
fôlego, <kbd>RT</kbd> corre, <kbd>View</kbd> caderno, <kbd>Menu</kbd> pausa.
O direcional responde perguntas, vira o caderno para o mapa e opera os menus
e os discos do armário.

No tablet ou no celular os controles ficam na tela: um analógico sob o
polegar esquerdo, olhar arrastando à direita, e botões para o resto. Jogue na
horizontal.

As Configurações têm dificuldade (História, Padrão, Pesadelo, Terror),
brilho, sensibilidade da visão, campo de visão, tamanho do texto, agachar
alternando, legendas de sons, dicas, redução de clarões e movimento,
qualidade gráfica, tela cheia e idioma.

**Modo Terror** (na tela inicial, ou como dificuldade) é para quem não se
assusta com o jogo: toda vez que as luzes piscam ele está mais perto, alguma
coisa respira logo atrás de você, os passageiros se mexem quando você desvia
o olhar, ele sabe onde você se esconde.

O interruptor MICROFONE do console de avisos, na Segurança, põe a sua própria
voz nos alto-falantes da rodoviária: ele pede o microfone, só grava enquanto
você segura a barra de falar, guarda a gravação na memória para tocá-la no
jogo, e nunca a salva nem a envia para lugar nenhum.

## Para rodar

Precisa do Node 22.

    npm ci
    npm run dev        # http://localhost:5173, recarrega enquanto você edita
    npm run build      # o jogo pronto, em dist/
    npm run preview    # serve o dist/ como uma hospedagem serviria

`npm run itch` gera o `last-departure-itch.zip` para enviar ao itch.io (veja
o [README em inglês](README.md#putting-it-on-itchio)); o texto da página em
português está em `promo/ITCH_PAGE.pt-BR.md`.

## Traduções

O inglês escrito no código é a chave: `t('Read the letter')` diz a frase no
idioma do jogo, e `src/lang/pt/` tem o português de cada uma (`interface.js`
para menus e HUD, `world.js` para a rodoviária, `story.js` para os textos de
`content.js`), com um glossário em `index.js`. Para conferir se falta
alguma tradução:

    npm run i18n:check
