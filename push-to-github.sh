#!/bin/bash

# Script para fazer push do repositório vzstore_lojaderoupas para GitHub
# Antes de executar, você precisa:
# 1. Criar um repositório vazio em https://github.com/new (com o nome vzstore_lojaderoupas)
# 2. Gerar um Personal Access Token em https://github.com/settings/tokens
# 3. Definir seu username do GitHub

echo "=== Setup do Repositório GitHub para VzSTORE ==="
echo ""

# Solicitar informações
read -p "Digite seu username do GitHub: " GITHUB_USER

if [ -z "$GITHUB_USER" ]; then
    echo "❌ Username não pode estar vazio!"
    exit 1
fi

echo ""
echo "Configurando repositório remoto..."

# Adicionar remote
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/$GITHUB_USER/vzstore_lojaderoupas.git"

echo "✅ Remote adicionado: https://github.com/$GITHUB_USER/vzstore_lojaderoupas.git"

echo ""
echo "Configurando branch principal..."

# Garantir que estamos na branch main
git branch -M main

echo "✅ Branch: main"

echo ""
echo "Fazendo push para GitHub..."
echo ""
echo "IMPORTANTE: Você será solicitado para autenticação."
echo "Use seu Personal Access Token (https://github.com/settings/tokens)"
echo "como senha quando perguntado."
echo ""

# Push
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ =========================================="
    echo "✅ Repositório enviado com sucesso!"
    echo "✅ =========================================="
    echo ""
    echo "Seu repositório está disponível em:"
    echo "👉 https://github.com/$GITHUB_USER/vzstore_lojaderoupas"
    echo ""
else
    echo ""
    echo "❌ Erro ao fazer push. Verifique:"
    echo "  1. Seu username do GitHub está correto"
    echo "  2. O repositório existe em GitHub"
    echo "  3. Seu Personal Access Token está válido"
    exit 1
fi
