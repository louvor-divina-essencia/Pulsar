# PULSAR

Aplicativo Android de performance musical: player, drum pads, pads tonais e metrônomo. Projeto independente do LouvorApp.

Esta é uma base de desenvolvimento 2.1, ainda em validação. Uma compilação bem-sucedida não substitui testes de áudio e de interface em aparelhos reais.

## Gerar o APK sem instalar ferramentas no computador

1. Abra **Actions → Gerar APK do PULSAR** neste repositório.
2. Selecione **Run workflow → Run workflow**, ou aguarde a execução automática após um envio para `main`.
3. Abra a execução e espere sua conclusão. Se falhar, consulte a etapa em vermelho; não haverá APK válido dessa execução.
4. Em **Artifacts**, baixe `PULSAR-2.1-teste-<número>`, extraia o ZIP e instale o APK no Android.

O primeiro teste exige Android 7.0 ou superior. O APK de depuração usa `br.com.utilitypad.app.preview` e o nome **PULSAR Teste**, para coexistir com a versão anterior, sem substituir seus dados. Ele começa com dados próprios; não desinstale o app anterior.

Cada execução usa a chave de depuração do ambiente de compilação. Atualizar um APK de teste por outro pode exigir reinstalar **somente o PULSAR Teste**, o que apaga os dados dessa instalação de teste. A assinatura estável para distribuição será configurada separadamente, sem publicar a chave privada. A versão de distribuição mantém o identificador `br.com.utilitypad.app`; atualizar a versão anterior também depende da assinatura original e de um `versionCode` superior.

## O que está incluído e o que ainda falta

- Base web e plugins Android para reprodução, importação e bibliotecas de áudio.
- Interface de duas camadas de pads tonais, ainda pendente de testes de concorrência, latência e uso prolongado.
- Análise experimental de BPM/tom no código; não deve ser tratada como detecção musical confiável nem como recurso finalizado.
- Integração de biblioteca por seleção de pasta do Android. **O catálogo automático pelo link público do Google Drive ainda não está implementado.**
- Os arquivos de áudio da biblioteca não estão neste repositório e não são incluídos no APK. Distribua apenas áudios para os quais você tenha autorização.

Organização da biblioteca informada pelo projeto: `PAD/REVERSE` (12 notas), `DRUM PAD/STARTER` e `DRUM PAD/WARM STARTER`. A disponibilidade de pastas depende do provedor de arquivos do Android.

## Desenvolvimento

Requisitos de compilação: Node.js 22+, Java 21 e Android SDK (plataforma 36). O Gradle Wrapper já faz parte do projeto.

```sh
npm ci
npm run check
npm run android:sync
cd android
./gradlew assembleDebug --no-daemon
```

No Windows, use `gradlew.bat` na última linha. Edite os plugins diretamente em `android/app/src/main/java/br/com/utilitypad/app/`; não apague nem recrie a pasta `android`, pois ela contém as personalizações nativas.

Não envie tokens, senhas, chaves de assinatura ou áudios pessoais ao repositório. Este repositório está público por decisão do proprietário; sua visibilidade e titularidade poderão ser revistas posteriormente.
