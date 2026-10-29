# Guia de Hospedagem 24/7 Contínua

Este guia explica como hospedar o aplicativo para transmissões contínuas 24 horas por dia, 7 dias por semana, sem depender do navegador ou de desligamentos do computador.

---

## 1. Passo a Passo Completo para o Render (Pronto no Macete!)

Já criamos os arquivos `render.yaml` e `Dockerfile` no projeto. O Render detectará tudo de forma 100% automática!

### Como subir no Render:
1. Suba esta pasta de código para um repositório no seu **GitHub** (público ou privado).
2. Acesse [dashboard.render.com](https://dashboard.render.com) e faça login.
3. Clique no botão azul **New +** no canto superior direito.
4. Escolha **Blueprint** (ou **Web Service**):
   * Se escolher **Blueprint**: basta selecionar o seu repositório no GitHub. O Render lerá o arquivo `render.yaml` que já deixamos pronto e configurará o serviço, a porta e o health check em 1 clique!
   * Se escolher **Web Service**: conecte o repositório, selecione o ambiente **Docker** e em Environment Variables defina `PORT=3000`.
5. Em cerca de 2 minutos, o Render fornecerá a sua URL pública (ex: `https://seu-app.onrender.com`).
6. Abra o link, cole sua chave do YouTube e inicie a transmissão!

### Dica de ouro para o Plano Grátis do Render:
* No plano grátis do Render, ele hiberna após 15 minutos sem acessos.
* Para contornar isso: crie uma conta gratuita no [UptimeRobot.com](https://uptimerobot.com), adicione um monitor HTTP com a URL `https://seu-app.onrender.com/health` e intervalo de **5 minutos**. O Render receberá o ping e continuará acordado!

---

## 2. Por que o Netlify NÃO serve?
* **O Netlify é uma plataforma de hospedagem de sites estáticos (HTML/CSS) e Serverless Functions.**
* Funções Serverless no Netlify têm um limite estrito de tempo de execução de **10 a 26 segundos**.
* Elas **não suportam processos de segundo plano persistentes como o FFmpeg** nem conexões RTMP contínuas.
* Se você colocar no Netlify, a transmissão cairá após 20 segundos.

---

## 3. As Melhores Opções para Lives 24/7 Reais

### Opção A: Railway (A Mais Fácil de Configurar - ~$5/mês)
1. Crie uma conta em [railway.app](https://railway.app).
2. Clique em **New Project** > **Deploy from GitHub repo**.
3. Selecione este repositório.
4. O Railway detectará o `Dockerfile` automaticamente e iniciará o container.
5. Em **Variables**, adicione `PORT=3000`.
6. Pronto! A live rodará 24/7 sem nunca hibernar.

---

### Opção B: VPS Linux (A Mais Barata e Estável de Todas - €3,50 a $5/mês)
Provedores recomendados:
* **Hetzner Cloud** (~€3,50/mês - servidor CPX11)
* **DigitalOcean Droplet** ($4 a $6/mês)
* **AWS Lightsail** ($3,50/mês)
* **Oracle Cloud Free Tier** (Gratuito 24/7 vitalício no plano ARM Ampere)

#### Como rodar na VPS com 3 comandos:

1. **Instale o Docker e Git na VPS:**
```bash
sudo apt update && sudo apt install -y docker.io git
```

2. **Clone seu projeto ou copie os arquivos:**
```bash
git clone <seu-repositorio> app
cd app
```

3. **Inicie o container para rodar para sempre em segundo plano:**
```bash
sudo docker build -t live-247 .
sudo docker run -d --restart always -p 80:3000 --name live live-247
```

Com o parâmetro `--restart always`, mesmo que o servidor VPS seja reiniciado, o container sobe sozinho e a live continua no ar!
