# Deploy para GitHub Pages (Opcional)

Se você quiser fazer deploy automático do site via GitHub Pages:

## Passos:

1. **Ir para Configurações do Repositório:**
   - GitHub → seu repositório → Settings → Pages

2. **Configurar GitHub Pages:**
   - Source: Deploy from a branch
   - Branch: main
   - Folder: / (root)
   - Salve

3. **Aguardar Deploy:**
   - GitHub vai automaticamente fazer build e deploy
   - Seu site ficará disponível em: `https://username.github.io/vzstore_lojaderoupas`

## URLs do Site:

- 🏠 **Home:** `/paginas/index.html`
- 📦 **Catálogo:** `/paginas/catalogo.html`
- 📄 **Sobre:** `/paginas/sobre.html`
- 📞 **Contato:** `/paginas/contato.html`
- 🔐 **Login:** `/paginas/acesso.html`

## Observações:

- O site funciona com arquivos estáticos (HTML, CSS, JS)
- Não requer backend ou servidor especial
- LocalStorage no navegador é usado para persistência local
- Compatível com GitHub Pages grátis

## Troubleshooting:

Se o site não carregar corretamente:
1. Verifique se todos os links relativos estão corretos
2. Teste localmente abrindo `paginas/index.html` no navegador
3. Verifique a aba "Pages" nas configurações do repositório
