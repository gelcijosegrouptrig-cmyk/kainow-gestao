#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MargemPRO - Gerador de PDF de Apresentação
Versão 2 - Layout otimizado sem LayoutError
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.platypus.flowables import Flowable
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle
from reportlab.graphics import renderPDF
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import datetime

# ─── PALETA DE CORES ──────────────────────────────────────────────────────────
AZUL_ESCURO   = HexColor('#0A1628')
AZUL_MEDIO    = HexColor('#1B3A6B')
AZUL_CLARO    = HexColor('#2563EB')
CIANO         = HexColor('#06B6D4')
VERDE         = HexColor('#10B981')
AMARELO       = HexColor('#F59E0B')
VERMELHO      = HexColor('#EF4444')
CINZA_ESCURO  = HexColor('#1F2937')
CINZA_MEDIO   = HexColor('#6B7280')
CINZA_CLARO   = HexColor('#F3F4F6')
BRANCO        = colors.white

W, H = A4  # 210 x 297 mm

# ─── CANVAS PERSONALIZADO ─────────────────────────────────────────────────────
class MargemPROCanvas(canvas.Canvas):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        self._saved_page_states = []
        self.total_pages = 0

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        self.total_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page()
            super().showPage()
        super().save()

    def _draw_page(self):
        pg = self._pageNumber
        # Rodapé apenas nas páginas internas (não capa)
        if pg > 1:
            self._draw_footer(pg)

    def _draw_footer(self, pg):
        self.saveState()
        # Linha
        self.setStrokeColor(AZUL_CLARO)
        self.setLineWidth(0.5)
        self.line(20*mm, 18*mm, W - 20*mm, 18*mm)
        # Texto esquerdo
        self.setFont('Helvetica', 7)
        self.setFillColor(CINZA_MEDIO)
        self.drawString(20*mm, 13*mm, 'MargemPRO — Sistema de Gestão de Margem Consignável')
        # Texto direito
        self.drawRightString(W - 20*mm, 13*mm, f'Pág. {pg} / {self.total_pages}')
        # Logo mini
        self.setFillColor(AZUL_CLARO)
        self.setFont('Helvetica-Bold', 7)
        self.drawCentredString(W/2, 13*mm, '© 2026 MargemPRO • Confidencial')
        self.restoreState()


# ─── FLOWABLE: CAPA ───────────────────────────────────────────────────────────
class CoverPage(Flowable):
    def __init__(self, width, height):
        super().__init__()
        self.width = width
        self.height = height

    def wrap(self, aW, aH):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        w, h = self.width, self.height

        # Fundo degradê simulado (retângulos em camadas)
        c.setFillColor(AZUL_ESCURO)
        c.rect(0, 0, w, h, fill=1, stroke=0)

        # Círculos decorativos
        c.setFillColor(HexColor('#1B3A6B'))
        c.circle(w * 0.85, h * 0.75, 120, fill=1, stroke=0)
        c.setFillColor(HexColor('#0F2545'))
        c.circle(w * 0.1, h * 0.2, 80, fill=1, stroke=0)
        c.setFillColor(HexColor('#2563EB'))
        c.setFillAlpha(0.15)
        c.circle(w * 0.5, h * 0.5, 200, fill=1, stroke=0)
        c.setFillAlpha(1.0)

        # Linha decorativa superior
        c.setStrokeColor(CIANO)
        c.setLineWidth(3)
        c.line(30*mm, h - 25*mm, w - 30*mm, h - 25*mm)

        # Badge "v2.0"
        c.setFillColor(CIANO)
        c.roundRect(w - 65*mm, h - 42*mm, 35*mm, 12*mm, 4, fill=1, stroke=0)
        c.setFillColor(AZUL_ESCURO)
        c.setFont('Helvetica-Bold', 9)
        c.drawCentredString(w - 47.5*mm, h - 37*mm, 'Versão 2.0')

        # Logo / Nome
        c.setFillColor(BRANCO)
        c.setFont('Helvetica-Bold', 42)
        c.drawCentredString(w/2, h * 0.62, 'MargemPRO')

        c.setFillColor(CIANO)
        c.setFont('Helvetica-Bold', 16)
        c.drawCentredString(w/2, h * 0.56, 'Sistema de Gestão de Margem Consignável')

        # Divisor
        c.setStrokeColor(CIANO)
        c.setLineWidth(1.5)
        c.line(w/2 - 60*mm, h * 0.53, w/2 + 60*mm, h * 0.53)

        # Subtítulo
        c.setFillColor(HexColor('#CBD5E1'))
        c.setFont('Helvetica', 13)
        c.drawCentredString(w/2, h * 0.485, 'Plataforma completa de Averbação, Faturamento e')
        c.drawCentredString(w/2, h * 0.455, 'Integração RH ↔ Banco para Convênios Públicos e Privados')

        # Pills de funcionalidades
        features = ['Billing por Transação', 'OAuth2 Bancário', 'Comprovantes SHA-256', 'Multi-convênio']
        pill_w = 42*mm
        pill_gap = 5*mm
        total = len(features) * pill_w + (len(features)-1) * pill_gap
        start_x = (w - total) / 2
        y_pill = h * 0.37
        for i, feat in enumerate(features):
            x = start_x + i * (pill_w + pill_gap)
            c.setFillColor(HexColor('#1B3A6B'))
            c.roundRect(x, y_pill, pill_w, 10*mm, 5, fill=1, stroke=0)
            c.setStrokeColor(CIANO)
            c.setLineWidth(0.5)
            c.roundRect(x, y_pill, pill_w, 10*mm, 5, fill=0, stroke=1)
            c.setFillColor(BRANCO)
            c.setFont('Helvetica-Bold', 7.5)
            c.drawCentredString(x + pill_w/2, y_pill + 3.5*mm, feat)

        # Métricas em destaque
        metrics = [('16', 'Endpoints\nde Billing'), ('5', 'Tabelas\nde Faturamento'), ('SHA-256', 'Comprovantes\nDigitais'), ('2', 'Modelos de\nPrecificação')]
        met_w = 38*mm
        total_m = len(metrics) * met_w + (len(metrics)-1) * 4*mm
        start_m = (w - total_m) / 2
        y_met = h * 0.22
        for i, (val, lbl) in enumerate(metrics):
            x = start_m + i * (met_w + 4*mm)
            c.setFillColor(HexColor('#0F2545'))
            c.roundRect(x, y_met, met_w, 22*mm, 6, fill=1, stroke=0)
            c.setStrokeColor(AZUL_CLARO)
            c.setLineWidth(0.8)
            c.roundRect(x, y_met, met_w, 22*mm, 6, fill=0, stroke=1)
            c.setFillColor(CIANO)
            c.setFont('Helvetica-Bold', 18)
            c.drawCentredString(x + met_w/2, y_met + 13*mm, val)
            c.setFillColor(HexColor('#94A3B8'))
            c.setFont('Helvetica', 7)
            lines = lbl.split('\n')
            for li, line in enumerate(lines):
                c.drawCentredString(x + met_w/2, y_met + 7*mm - li*4.5*mm, line)

        # Data e confidencial
        c.setFillColor(HexColor('#64748B'))
        c.setFont('Helvetica', 9)
        data = datetime.datetime.now().strftime('%B de %Y').capitalize()
        c.drawCentredString(w/2, 30*mm, f'Abril de 2026  •  Documento Confidencial')

        # Linha inferior
        c.setStrokeColor(CIANO)
        c.setLineWidth(2)
        c.line(30*mm, 22*mm, w - 30*mm, 22*mm)


# ─── FLOWABLE: CABEÇALHO DE SEÇÃO ─────────────────────────────────────────────
class SectionHeader(Flowable):
    def __init__(self, number, title, subtitle='', color=AZUL_CLARO):
        super().__init__()
        self.number = number
        self.title = title
        self.subtitle = subtitle
        self.color = color
        self.width = W - 40*mm
        self.height = 22*mm

    def wrap(self, aW, aH):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        w = self.width

        # Fundo
        c.setFillColor(self.color)
        c.roundRect(0, 2*mm, w, 18*mm, 4, fill=1, stroke=0)

        # Número da seção
        c.setFillColor(BRANCO)
        c.setFont('Helvetica-Bold', 22)
        c.drawString(6*mm, 8*mm, self.number)

        # Linha vertical
        c.setStrokeColor(BRANCO)
        c.setLineWidth(1)
        c.setStrokeAlpha(0.4)
        c.line(22*mm, 4*mm, 22*mm, 18*mm)
        c.setStrokeAlpha(1.0)

        # Título
        c.setFillColor(BRANCO)
        c.setFont('Helvetica-Bold', 14)
        c.drawString(26*mm, 11.5*mm, self.title)

        # Subtítulo
        if self.subtitle:
            c.setFont('Helvetica', 9)
            c.setFillColor(HexColor('#DBEAFE'))
            c.drawString(26*mm, 6*mm, self.subtitle)


# ─── FLOWABLE: CARD COLORIDO ──────────────────────────────────────────────────
class ColorCard(Flowable):
    def __init__(self, title, value, subtitle, color=AZUL_CLARO, width=40*mm, height=28*mm):
        super().__init__()
        self.title = title
        self.value = value
        self.subtitle = subtitle
        self.color = color
        self.width = width
        self.height = height

    def wrap(self, aW, aH):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        # Sombra
        c.setFillColor(HexColor('#00000020'))
        c.roundRect(1.5*mm, 0, self.width - 1.5*mm, self.height - 1.5*mm, 5, fill=1, stroke=0)
        # Card
        c.setFillColor(self.color)
        c.roundRect(0, 1.5*mm, self.width - 1.5*mm, self.height - 1.5*mm, 5, fill=1, stroke=0)
        # Título
        c.setFillColor(HexColor('#DBEAFE'))
        c.setFont('Helvetica', 7.5)
        c.drawString(4*mm, self.height - 7*mm, self.title)
        # Valor
        c.setFillColor(BRANCO)
        c.setFont('Helvetica-Bold', 16)
        c.drawString(4*mm, self.height - 16*mm, self.value)
        # Subtítulo
        c.setFillColor(HexColor('#93C5FD'))
        c.setFont('Helvetica', 7)
        c.drawString(4*mm, 5*mm, self.subtitle)


# ─── FLOWABLE: DIAGRAMA DE FLUXO ──────────────────────────────────────────────
class FlowDiagram(Flowable):
    """Diagrama simples de fluxo de averbação → billing"""
    def __init__(self, width, height=50*mm):
        super().__init__()
        self.width = width
        self.height = height

    def wrap(self, aW, aH):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        steps = [
            ('Banco', 'Solicita\nAverbação', AZUL_CLARO),
            ('Sistema', 'Valida\nMargem', VERDE),
            ('Registro', 'Cria\nAverbação', CIANO),
            ('Aprovação', 'Status\nAPROVADA', AMARELO),
            ('Billing', 'Gera\nFatura', VERMELHO),
            ('Comprovante', 'Hash\nSHA-256', HexColor('#8B5CF6')),
        ]
        n = len(steps)
        box_w = (self.width - (n-1)*8*mm) / n
        box_h = 25*mm
        y = (self.height - box_h) / 2

        for i, (title, label, color) in enumerate(steps):
            x = i * (box_w + 8*mm)
            # Caixa
            c.setFillColor(color)
            c.roundRect(x, y, box_w, box_h, 5, fill=1, stroke=0)
            # Título
            c.setFillColor(BRANCO)
            c.setFont('Helvetica-Bold', 7)
            c.drawCentredString(x + box_w/2, y + box_h - 7*mm, title)
            # Label
            c.setFont('Helvetica', 6.5)
            for li, line in enumerate(label.split('\n')):
                c.drawCentredString(x + box_w/2, y + box_h/2 - 1.5*mm - li*4.5*mm, line)
            # Seta
            if i < n - 1:
                ax = x + box_w + 1*mm
                ay = y + box_h/2
                c.setStrokeColor(CINZA_MEDIO)
                c.setLineWidth(1.5)
                c.line(ax, ay, ax + 5*mm, ay)
                # ponta da seta (triângulo via path)
                c.setFillColor(CINZA_MEDIO)
                p = c.beginPath()
                p.moveTo(ax + 6*mm, ay)
                p.lineTo(ax + 4.5*mm, ay + 1.5*mm)
                p.lineTo(ax + 4.5*mm, ay - 1.5*mm)
                p.close()
                c.drawPath(p, fill=1, stroke=0)


# ─── ESTILOS DE TEXTO ─────────────────────────────────────────────────────────
def make_styles():
    base = getSampleStyleSheet()
    styles = {}

    styles['title'] = ParagraphStyle('title',
        fontSize=20, fontName='Helvetica-Bold', textColor=AZUL_ESCURO,
        spaceAfter=4, alignment=TA_CENTER)

    styles['h2'] = ParagraphStyle('h2',
        fontSize=13, fontName='Helvetica-Bold', textColor=AZUL_MEDIO,
        spaceBefore=8, spaceAfter=4)

    styles['h3'] = ParagraphStyle('h3',
        fontSize=10, fontName='Helvetica-Bold', textColor=AZUL_CLARO,
        spaceBefore=6, spaceAfter=3)

    styles['body'] = ParagraphStyle('body',
        fontSize=9, fontName='Helvetica', textColor=CINZA_ESCURO,
        spaceAfter=4, leading=14, alignment=TA_JUSTIFY)

    styles['bullet'] = ParagraphStyle('bullet',
        fontSize=9, fontName='Helvetica', textColor=CINZA_ESCURO,
        spaceAfter=3, leftIndent=10, leading=13,
        bulletIndent=0, bulletFontName='Helvetica', bulletFontSize=9)

    styles['code'] = ParagraphStyle('code',
        fontSize=7.5, fontName='Courier', textColor=HexColor('#1E40AF'),
        backColor=HexColor('#EFF6FF'), spaceAfter=2, leading=11,
        leftIndent=8, rightIndent=8)

    styles['caption'] = ParagraphStyle('caption',
        fontSize=8, fontName='Helvetica-Oblique', textColor=CINZA_MEDIO,
        alignment=TA_CENTER, spaceAfter=4)

    styles['highlight'] = ParagraphStyle('highlight',
        fontSize=9, fontName='Helvetica-Bold', textColor=BRANCO,
        backColor=AZUL_CLARO, spaceAfter=4, leading=14,
        leftIndent=8, rightIndent=8)

    styles['small'] = ParagraphStyle('small',
        fontSize=7.5, fontName='Helvetica', textColor=CINZA_MEDIO,
        spaceAfter=2, leading=11)

    return styles


# ─── BUILDER DE TABELA ESTILIZADA ─────────────────────────────────────────────
def make_table(data, col_widths, header=True, zebra=True):
    style_cmds = [
        ('FONTNAME',    (0,0), (-1,0 if header else -1), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,0), (-1,-1), 8),
        ('BACKGROUND',  (0,0), (-1,0), AZUL_MEDIO),
        ('TEXTCOLOR',   (0,0), (-1,0), BRANCO),
        ('ALIGN',       (0,0), (-1,-1), 'CENTER'),
        ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
        ('ROWBACKGROUND',(0,1),(-1,-1), [CINZA_CLARO, BRANCO]),
        ('GRID',        (0,0), (-1,-1), 0.3, HexColor('#D1D5DB')),
        ('TOPPADDING',  (0,0), (-1,-1), 4),
        ('BOTTOMPADDING',(0,0),(-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING',(0,0), (-1,-1), 5),
        ('ROWBACKGROUND',(0,1),(-1,-1),[CINZA_CLARO,BRANCO]),
    ]
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(style_cmds))
    return t


# ─── CONTEÚDO DO PDF ──────────────────────────────────────────────────────────
def build_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=20*mm,
        rightMargin=20*mm,
        topMargin=20*mm,
        bottomMargin=25*mm,
        title='MargemPRO — Apresentação do Sistema',
        author='MargemPRO',
        subject='Billing por Transação e Gestão de Margem Consignável',
    )

    S = make_styles()
    story = []
    CW = W - 40*mm  # content width

    # ══════════════════════════════════════════════════════════════════
    # CAPA
    # ══════════════════════════════════════════════════════════════════
    story.append(CoverPage(CW, 230*mm))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 1. VISÃO GERAL
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('01', 'Visão Geral do Sistema', 'O que é o MargemPRO e para quem se destina'))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        'O <b>MargemPRO</b> é uma plataforma SaaS de gestão de margem consignável, '
        'projetada para interligar <b>Prefeituras/RH</b>, <b>Bancos/Fintechs</b> e '
        '<b>Correspondentes Bancários</b> em um único ecossistema digital seguro, '
        'auditável e completo.', S['body']))
    story.append(Spacer(1, 3*mm))

    # Cards de stakeholders
    stakeholders = [
        ('🏛️ Prefeituras / RH', 'Acesso GRATUITO\nGestão de margem\nImportação de folha\nControle de averbações', AZUL_MEDIO),
        ('🏦 Bancos / Fintechs', 'Pós-pago: fatura mensal\nPré-pago: pacote de créditos\nAPI OAuth2 segura\nWebhooks em tempo real', VERDE),
        ('🤝 Correspondentes', 'Modelo pré-pago\nCréditos por pacote\nBloqueio automático\nRelatórios em tempo real', CIANO),
    ]
    card_w = CW / 3 - 4*mm
    rows = [[]]
    for title, desc, color in stakeholders:
        lines = desc.split('\n')
        cell_data = [Paragraph(f'<b>{title}</b>', ParagraphStyle('ch', fontSize=8.5, fontName='Helvetica-Bold', textColor=BRANCO, alignment=TA_CENTER))]
        for ln in lines:
            cell_data.append(Paragraph(f'• {ln}', ParagraphStyle('cl', fontSize=8, fontName='Helvetica', textColor=HexColor('#DBEAFE'), alignment=TA_LEFT, leftIndent=4)))
        rows[0].append(cell_data)
    
    tbl_stake = Table([rows[0]], colWidths=[card_w]*3)
    tbl_stake.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,0), AZUL_MEDIO),
        ('BACKGROUND', (1,0), (1,0), VERDE),
        ('BACKGROUND', (2,0), (2,0), CIANO),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROUNDEDCORNERS', (0,0), (-1,-1), [4,4,4,4]),
        ('LINEAFTER', (0,0), (1,0), 3, BRANCO),
    ]))
    story.append(tbl_stake)
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Proposta de Valor — Zero‑Cost RH Strategy</b>', S['h3']))
    story.append(Paragraph(
        'A Prefeitura/RH <b>não paga nada</b> pelo sistema. A receita vem dos bancos que '
        'pagam por cada averbação processada (R$15–R$25/transação) e de uma cláusula de '
        'manutenção contratual (ex: R$1/mês por 48 meses). Isso cria um modelo '
        '<b>sustentável, escalável e de baixa resistência</b> na adoção pública.', S['body']))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 2. ARQUITETURA
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('02', 'Arquitetura Técnica', 'Stack, banco de dados e integração'))
    story.append(Spacer(1, 5*mm))

    arch_data = [
        ['Camada', 'Tecnologia', 'Função'],
        ['Backend API', 'Node.js + Express', 'REST API com autenticação JWT e OAuth2'],
        ['Banco de Dados', 'SQLite (better-sqlite3)', 'Armazenamento persistente com WAL mode'],
        ['Autenticação', 'JWT + OAuth2 PKCE', 'Sessões seguras para RH e Bancos'],
        ['Certificados', 'ICP-Brasil / PKCS#12', 'Assinatura digital de comprovantes'],
        ['Frontend', 'HTML5 + Vanilla JS', 'SPA multi-módulo com 60+ seções'],
        ['Webhooks', 'HTTP/HTTPS callbacks', 'Notificações em tempo real para bancos'],
        ['Hashing', 'SHA-256', 'Integridade de comprovantes (bilhetes)'],
    ]
    story.append(make_table(arch_data,
        [35*mm, 45*mm, CW - 80*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Tabelas Principais do Banco de Dados</b>', S['h3']))
    db_data = [
        ['Tabela', 'Registros Chave', 'Finalidade'],
        ['funcionarios', 'matricula, cpf, salario_bruto, margem_disponivel', 'Cadastro de servidores e saldo de margem'],
        ['averbacoes', 'codigo_averbacao, status, valor_parcela, prazo', 'Contratos de desconto em folha'],
        ['margens', 'margem_emprestimo, margem_cartao, margem_beneficio', 'Saldos de margem por categoria'],
        ['reservas_margem', 'status, expiracao, averbacao_id', 'Bloqueio temporário de margem'],
        ['tarifas_banco_convenio', 'banco_id, convenio_id, valor_tarifa, modelo', 'Tarifas personalizadas por banco'],
        ['faturamento_ciclos', 'competencia, status, total_averbacoes', 'Fechamento mensal por banco'],
        ['faturamento_itens', 'averbacao_id, valor_tarifa, hash_comprovante', 'Linhas de fatura com comprovante'],
        ['faturamento_creditos', 'banco_id, saldo_atual, status', 'Carteira pré-paga de créditos'],
        ['bilhetes_averbacao', 'hash_sha256, assinatura, timestamp', 'Comprovantes digitais imutáveis'],
        ['oauth2_clients', 'client_id, client_secret, bank_id', 'Credenciais OAuth2 por banco'],
    ]
    story.append(make_table(db_data,
        [42*mm, 70*mm, CW - 112*mm]))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 3. FLUXO DE AVERBAÇÃO
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('03', 'Fluxo de Averbação', 'Do pedido do banco à prova digital'))
    story.append(Spacer(1, 5*mm))

    story.append(FlowDiagram(CW, 50*mm))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph(
        '<b>Descrição do Fluxo Completo:</b>', S['h3']))

    steps = [
        ('1', 'Banco autentica via OAuth2', 'O banco obtém token de acesso usando client_id/client_secret. Scopes disponíveis: averbacoes:create, averbacoes:read, margens:read.'),
        ('2', 'Consulta de Margem', 'O sistema verifica margem disponível do servidor (salário × 35% − descontos existentes). Reserva temporária com TTL de 30 minutos criada automaticamente.'),
        ('3', 'Criação da Averbação', 'POST /api/averbacoes com dados do contrato. Sistema gera código único (ex: BB-202604-A1B2-C3D4) e calcula valor total.'),
        ('4', 'Aprovação e Trigger de Billing', 'PATCH /api/averbacoes/:id/aprovar dispara automaticamente: criação/atualização do ciclo de faturamento, registro do item de fatura com hash SHA-256, geração de comprovante digital, débito de crédito pré-pago (se aplicável).'),
        ('5', 'Comprovante Digital', 'Bilhete gerado com hash SHA-256 do conteúdo + timestamp imutável. Validação via GET /api/faturamento/comprovante/:id retorna "VÁLIDA ✅" ou "VIOLADA ⚠️".'),
        ('6', 'Fechamento de Ciclo', 'No final do mês (ou manualmente), o ciclo ABERTO → FECHADO → FATURADO → PAGO. Fatura gerada com código único (ex: FAT-202604-XXXX).'),
    ]

    for num, title, desc in steps:
        row_data = [[
            Paragraph(num, ParagraphStyle('num', fontSize=12, fontName='Helvetica-Bold', textColor=BRANCO, alignment=TA_CENTER)),
            [Paragraph(f'<b>{title}</b>', S['h3']), Paragraph(desc, S['body'])]
        ]]
        t = Table(row_data, colWidths=[10*mm, CW - 10*mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (0,0), AZUL_CLARO),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LEFTPADDING', (0,0), (-1,-1), 4),
            ('RIGHTPADDING', (0,0), (-1,-1), 4),
            ('LINEBELOW', (0,0), (-1,-1), 0.5, HexColor('#E5E7EB')),
        ]))
        story.append(t)
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 4. SISTEMA DE FATURAMENTO
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('04', 'Sistema de Faturamento', 'Billing por transação — Modelos Pós e Pré-pago'))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph('<b>Modelos de Precificação</b>', S['h3']))

    model_data = [
        ['Característica', '📬 Pós-Pago', '💳 Pré-Pago'],
        ['Público-alvo', 'Bancos médios/grandes', 'Correspondentes e Fintechs'],
        ['Cobrança', 'Final do mês (ciclo)', 'Pacote de créditos antecipado'],
        ['Vencimento', 'Todo dia 5 do mês seguinte', 'Uso até esgotar o saldo'],
        ['Bloqueio', 'Não bloqueia operações', 'Bloqueia ao zerar créditos'],
        ['Tarifa padrão', 'R$15,00–R$25,00/averb.', 'R$12,00–R$20,00/averb.'],
        ['Desconto vol.', 'Negociável por contrato', 'Embutido no pacote'],
        ['Relatório', 'FAT-AAAAMM-XXXX PDF/CSV', 'Extrato de consumo em tempo real'],
    ]
    story.append(make_table(model_data, [50*mm, (CW-50*mm)/2, (CW-50*mm)/2]))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph('<b>Endpoints da API de Faturamento (16 rotas)</b>', S['h3']))
    api_data = [
        ['Método', 'Endpoint', 'Descrição'],
        ['GET',   '/api/faturamento/dashboard',           'KPIs: receita, total averb., projeção anual'],
        ['GET',   '/api/faturamento/ciclos',              'Lista ciclos mensais com filtros'],
        ['POST',  '/api/faturamento/ciclos',              'Abre novo ciclo de faturamento'],
        ['PATCH', '/api/faturamento/ciclos/:id/fechar',   'Fecha ciclo e gera número de fatura'],
        ['PATCH', '/api/faturamento/ciclos/:id/faturar',  'Emite fatura (FECHADO→FATURADO)'],
        ['PATCH', '/api/faturamento/ciclos/:id/pago',     'Marca fatura como PAGA'],
        ['GET',   '/api/faturamento/comprovante/:id',     'Retorna comprovante com validação SHA-256'],
        ['GET',   '/api/faturamento/extrato',             'Extrato detalhado com filtros e total'],
        ['GET',   '/api/faturamento/extrato/csv',         'Download do extrato em CSV'],
        ['GET',   '/api/faturamento/tarifas',             'Lista tarifas por banco×convênio'],
        ['POST',  '/api/faturamento/tarifas',             'Cria/atualiza tarifa negociada'],
        ['GET',   '/api/faturamento/creditos',            'Saldo e histórico de créditos pré-pagos'],
        ['POST',  '/api/faturamento/creditos',            'Recarga de pacote de créditos'],
        ['GET',   '/api/faturamento/relatorio-banco',     'Relatório anual consolidado por banco'],
        ['GET',   '/api/faturamento/projecao',            'Simulação: vidas × taxa → receita/ano'],
        ['GET',   '/api/faturamento/exportar-fatura/:id', 'PDF/JSON da fatura fechada'],
    ]
    story.append(make_table(api_data,
        [15*mm, 75*mm, CW - 90*mm]))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 5. COMPROVANTE DIGITAL
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('05', 'Comprovante Digital de Averbação',
        'Prova jurídica com hash SHA-256 e timestamp imutável', VERDE))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        'Cada averbação aprovada gera automaticamente um <b>Bilhete Digital</b> com '
        'integridade garantida por hash SHA-256. Este comprovante serve como '
        '<b>prova jurídica</b> em disputas entre banco e servidor público.', S['body']))
    story.append(Spacer(1, 3*mm))

    # Simulação de comprovante
    comp_data = [
        ['Campo', 'Valor', 'Descrição'],
        ['codigo_averbacao', 'BB-202604-A1B2-C3D4', 'Identificador único da averbação'],
        ['funcionario', 'João da Silva (Mat. 12345)', 'Servidor titular do contrato'],
        ['banco', 'Banco do Brasil', 'Instituição financeira contratante'],
        ['valor_parcela', 'R$ 450,00 / mês', 'Valor mensal deduzido em folha'],
        ['prazo', '36 meses', 'Duração total do contrato'],
        ['taxa_averbacao', 'R$ 18,50', 'Tarifa cobrada por esta averbação'],
        ['timestamp', '2026-04-29T21:00:00.000Z', 'Data/hora UTC de aprovação'],
        ['hash_sha256', '5109c81e3c2bdc57ee2703...', 'Assinatura digital do conteúdo'],
        ['integridade', '✅ VÁLIDA', 'Resultado da verificação do hash'],
        ['status', 'APROVADA', 'Estado atual da averbação'],
    ]
    story.append(make_table(comp_data, [38*mm, 65*mm, CW - 103*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Como Funciona a Validação de Integridade</b>', S['h3']))
    story.append(Paragraph(
        '1. No momento da aprovação, o sistema concatena todos os campos críticos da averbação '
        '(código, funcionário, banco, valor, prazo, timestamp) e calcula o SHA-256.<br/>'
        '2. O hash é armazenado junto ao comprovante de forma imutável.<br/>'
        '3. A qualquer momento, o endpoint <b>GET /api/faturamento/comprovante/:id</b> '
        'recalcula o hash e compara: resultado <b>VÁLIDA ✅</b> confirma integridade; '
        '<b>VIOLADA ⚠️</b> indica adulteração.<br/>'
        '4. Adequado para uso em <b>processos administrativos, ações judiciais e auditorias</b>.', S['body']))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph('<b>Cláusula de Manutenção Contratual</b>', S['h3']))
    story.append(Paragraph(
        'Os contratos com bancos incluem obrigatoriamente uma cláusula de manutenção mensal '
        '(ex: <b>R$1,00/mês por 48 meses</b> = R$48,00 por banco/convênio). Esta cláusula '
        'garante receita recorrente mínima independente do volume de transações, e incentiva '
        'os bancos a manterem integrações ativas.', S['body']))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 6. MÓDULO FECHAMENTO DE CICLO (ADMIN)
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('06', 'Painel Admin — Fechamento de Ciclo',
        'Gestão completa de ciclos mensais e relatórios bancários', AMARELO))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        'O painel <b>"Fechamento de Ciclo"</b> centraliza toda a gestão financeira da plataforma. '
        'Accessible via dashboard admin, oferece controle total sobre o faturamento mensal '
        'por banco e convênio.', S['body']))
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph('<b>5 Abas do Dashboard de Faturamento</b>', S['h3']))
    tabs_data = [
        ['Aba', 'Conteúdo Principal', 'Ações Disponíveis'],
        ['📊 Dashboard', 'KPIs (receita total, n° averb., taxa média, projeção anual), gráfico 6 meses, extrato com comprovante inline', 'Filtrar por período e banco'],
        ['📅 Fechamento\nde Ciclo', 'Tabela de ciclos por banco (status, competência, total averb., valor), detalhe lateral com itens', 'Faturar, Pago, Exportar PDF/CSV'],
        ['🏷️ Tarifas', 'CRUD de tarifas por banco×convênio, modelo POS/PRÉ, dia de vencimento, desconto por volume', 'Criar, Editar, Ativar/Desativar'],
        ['💳 Créditos\nPré-pagos', 'Saldo atual com alertas (BAIXO/BLOQUEADO), histórico de recargas e consumo por banco', 'Recarregar pacote, Ver histórico'],
        ['📈 Projeção', 'Calculadora: n° vidas × taxa → receita mensal/anual, gráfico 12 meses, break-even', 'Ajustar parâmetros e simular'],
    ]
    story.append(make_table(tabs_data,
        [22*mm, 75*mm, CW - 97*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Ciclo de Vida do Faturamento</b>', S['h3']))
    lifecycle = [
        ['Status', 'Significado', 'Próximo Passo'],
        ['🟡 ABERTO', 'Ciclo em andamento, recebendo averbações', 'Fechar ao final do período'],
        ['🔵 FECHADO', 'Sem novas averbações, aguardando emissão', 'Emitir fatura formal'],
        ['🟠 FATURADO', 'Fatura emitida, aguardando pagamento', 'Banco realiza pagamento'],
        ['🟢 PAGO', 'Pagamento confirmado, ciclo encerrado', 'Arquivado para auditoria'],
    ]
    story.append(make_table(lifecycle,
        [25*mm, 70*mm, CW - 95*mm]))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 7. PROJEÇÃO DE RECEITA
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('07', 'Projeção de Receita', 'Modelos financeiros e escalabilidade', VERDE))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        '<b>Premissa conservadora:</b> 5% das vidas (servidores) averbam por mês. '
        'Taxa de averbação: R$20/transação (média de mercado). '
        'Valores em BRL.', S['body']))
    story.append(Spacer(1, 3*mm))

    proj_data = [
        ['Vidas Ativas', 'Averb/Mês', 'Receita/Mês', 'Receita/Ano', 'Break-even'],
        ['500', '25', 'R$ 500,00', 'R$ 6.000,00', '< 1 mês'],
        ['1.000', '50', 'R$ 1.000,00', 'R$ 12.000,00', '< 1 mês'],
        ['2.000', '100', 'R$ 2.000,00', 'R$ 24.000,00', '< 1 mês'],
        ['5.000', '250', 'R$ 5.000,00', 'R$ 60.000,00', '1 mês'],
        ['10.000', '500', 'R$ 10.000,00', 'R$ 120.000,00', '1 mês'],
        ['25.000', '1.250', 'R$ 25.000,00', 'R$ 300.000,00', '1 mês'],
        ['50.000', '2.500', 'R$ 50.000,00', 'R$ 600.000,00', '1 mês'],
        ['100.000', '5.000', 'R$ 100.000,00', 'R$ 1.200.000,00', '1 mês'],
    ]
    t = make_table(proj_data,
        [30*mm, 25*mm, 40*mm, 40*mm, CW - 135*mm])
    # Destaque na linha de 10k
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,5), (-1,5), HexColor('#DCFCE7')),
        ('TEXTCOLOR',  (0,5), (-1,5), CINZA_ESCURO),
        ('FONTNAME',   (0,5), (-1,5), 'Helvetica-Bold'),
    ]))
    story.append(t)
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Fontes de Receita Combinadas</b>', S['h3']))
    revenue_data = [
        ['Fonte', 'Modelo', 'Exemplo (10k vidas)', 'Recorrência'],
        ['Taxa por averbação', 'R$15–R$25/transação', 'R$10.000/mês', 'Variável'],
        ['Cláusula de manutenção', 'R$1/banco/mês (48m)', 'R$48×n_bancos', 'Fixa'],
        ['Recarga de créditos', 'Pacotes pré-pagos', 'Por demanda', 'Flexível'],
        ['Certificados digitais', 'ICP-Brasil emissão', 'Por servidor', 'Anual'],
        ['Suporte premium', 'SLA estendido', 'R$X/mês', 'Mensal'],
    ]
    story.append(make_table(revenue_data,
        [40*mm, 42*mm, 45*mm, CW - 127*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph(
        '🔑 <b>Insight estratégico:</b> Uma prefeitura com 10.000 servidores, 3 bancos parceiros '
        'e taxa de R$20/averbação gera <b>R$120.000/ano</b> + cláusula de manutenção, '
        'sem custos operacionais de vendas (o próprio RH vende para os bancos por interesse mútuo).', S['body']))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 8. INTEGRAÇÃO RH ↔ BANCO
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('08', 'Integração RH ↔ Banco', 'APIs, OAuth2, Webhooks e eSocial'))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        'O MargemPRO funciona como um <b>hub central</b> entre o sistema de RH da prefeitura '
        'e os sistemas bancários, eliminando processos manuais, planilhas e trocas de arquivos por e-mail.', S['body']))
    story.append(Spacer(1, 3*mm))

    integ_data = [
        ['Módulo', 'Tecnologia', 'Benefício'],
        ['Importação de Folha', 'Upload CSV/XML, layout customizável', 'Atualização automática de margens e salários'],
        ['OAuth2 Bancário', 'PKCE + scopes granulares', 'Acesso seguro sem senhas compartilhadas'],
        ['Webhooks', 'HTTP POST com HMAC-SHA256', 'Notificação imediata de aprovações/cancelamentos'],
        ['Reserva de Margem', 'TTL configurável (default 30min)', 'Evita dupla averbação durante análise do banco'],
        ['Portabilidade', 'Banco origem → destino via API', 'Processo digital sem papel ou ligações'],
        ['eSocial', 'Eventos S-1200, S-1210, S-2299', 'Conformidade legal com obrigações trabalhistas'],
        ['Consulta Margem', 'GET /api/banco/margem/consultar', 'Resposta em < 200ms com disponibilidade'],
        ['Descontos em Folha', 'Arquivo gerado por competência', 'Processamento automático no fechamento de folha'],
    ]
    story.append(make_table(integ_data,
        [38*mm, 60*mm, CW - 98*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Fluxo de Autenticação OAuth2</b>', S['h3']))
    oauth_steps = [
        '1. Banco registra <b>client_id</b> e <b>client_secret</b> no MargemPRO (painel admin)',
        '2. Banco envia POST /oauth2/token com credenciais e grant_type=client_credentials',
        '3. Sistema valida e retorna access_token (TTL: 1 hora) + refresh_token',
        '4. Banco inclui <b>Authorization: Bearer {token}</b> em todas as requisições',
        '5. Sistema valida token, verifica scopes e registra log de auditoria',
        '6. Ao expirar, banco usa refresh_token para obter novo access_token sem re-login',
    ]
    for step in oauth_steps:
        story.append(Paragraph(f'• {step}', S['bullet']))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 9. SEGURANÇA E CONFORMIDADE
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('09', 'Segurança e Conformidade',
        'LGPD, ISO 27001, ICP-Brasil e Auditoria Completa', VERMELHO))
    story.append(Spacer(1, 5*mm))

    sec_data = [
        ['Controle', 'Implementação', 'Norma/Padrão'],
        ['Autenticação', 'JWT + OAuth2 PKCE, 2FA opcional', 'ISO 27001 A.9'],
        ['Criptografia em Trânsito', 'TLS 1.2+ obrigatório', 'LGPD Art. 46'],
        ['Criptografia em Repouso', 'SQLite WAL + FIPS 140-2 (futuro)', 'ISO 27001 A.10'],
        ['Assinatura Digital', 'ICP-Brasil PKCS#12 / SHA-256', 'MP 2.200-2/2001'],
        ['Log de Auditoria', 'logs_auditoria com user, ação, timestamp, IP', 'LGPD Art. 37'],
        ['Controle de Acesso', 'RBAC: admin, rh, banco, auditor', 'ISO 27001 A.9.4'],
        ['Integridade de Dados', 'Hash SHA-256 em comprovantes', 'ISO 27001 A.12'],
        ['Retenção de Dados', 'Configurável por convênio', 'LGPD Art. 16'],
        ['Backup', 'SQLite WAL + cópia periódica', 'ISO 27001 A.12.3'],
        ['Notificação de Incidentes', 'Webhook + e-mail para admin', 'LGPD Art. 48'],
    ]
    story.append(make_table(sec_data,
        [42*mm, 70*mm, CW - 112*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Perfis de Acesso (RBAC)</b>', S['h3']))
    rbac_data = [
        ['Perfil', 'Módulos de Acesso', 'Restrições'],
        ['admin', 'Todos os módulos + configurações', 'Nenhuma — acesso total'],
        ['rh', 'Funcionários, convênios, importação de folha, margem, eSocial', 'Não acessa faturamento de bancos'],
        ['banco', 'Averbações do próprio banco, margem, comprovantes, extrato próprio', 'Não vê dados de outros bancos'],
        ['auditor', 'Logs de auditoria, relatórios (somente leitura)', 'Apenas visualização'],
        ['operador', 'Averbações, consultas, reservas (sem cancelar)', 'Sem acesso a configurações'],
    ]
    story.append(make_table(rbac_data,
        [22*mm, 75*mm, CW - 97*mm]))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 10. ROADMAP E PRÓXIMOS PASSOS
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('10', 'Roadmap e Próximos Passos',
        'Evolução planejada e sugestões de expansão', HexColor('#8B5CF6')))
    story.append(Spacer(1, 5*mm))

    roadmap_data = [
        ['Fase', 'Prazo', 'Entregáveis', 'Status'],
        ['MVP (v2.0)', 'Entregue', 'Core completo: averbações, billing, OAuth2, comprovantes, frontend 60+ módulos', '✅ Completo'],
        ['v2.1 — Boletos', 'Mês 1', 'Geração automática de boletos bancários vinculados ao ciclo de faturamento', '🔜 Planejado'],
        ['v2.2 — App Mobile', 'Mês 2', 'App para servidores: saldo de margem, extrato de contratos, notificações push', '📋 Backlog'],
        ['v2.3 — PIX', 'Mês 2', 'Pagamento de faturas via PIX automático; cobrança recorrente por débito', '📋 Backlog'],
        ['v2.4 — BI/Analytics', 'Mês 3', 'Dashboard executivo com gráficos avançados, exportação para Power BI/Tableau', '📋 Backlog'],
        ['v3.0 — Multi-tenant', 'Mês 4', 'Isolamento por tenant, white-label para bancos, SaaS público escalável', '🎯 Meta'],
        ['v3.1 — Open Finance', 'Mês 6', 'Integração com Open Finance Bacen; portabilidade automática entre bancos', '🎯 Meta'],
    ]
    story.append(make_table(roadmap_data,
        [22*mm, 18*mm, 95*mm, CW - 135*mm]))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph('<b>Indicadores de Sucesso (KPIs Sugeridos)</b>', S['h3']))
    kpi_data = [
        ['KPI', 'Meta Mês 1', 'Meta Mês 6', 'Meta Ano 1'],
        ['Vidas Ativas no Sistema', '1.000', '5.000', '10.000'],
        ['Averbações/Mês', '50', '250', '500'],
        ['Receita Mensal', 'R$1.000', 'R$5.000', 'R$10.000'],
        ['Bancos Integrados', '2', '5', '10'],
        ['Convênios Ativos', '1', '3', '8'],
        ['Uptime da API', '99%', '99.5%', '99.9%'],
        ['Tempo de Resposta API', '< 500ms', '< 300ms', '< 200ms'],
    ]
    story.append(make_table(kpi_data,
        [55*mm, (CW-55*mm)/3, (CW-55*mm)/3, (CW-55*mm)/3]))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        '📧 <b>Para estimar receita do 1° ano:</b> informe o número estimado de servidores '
        '(vidas) da(s) prefeitura(s) parceira(s). O sistema calculará automaticamente via '
        '<b>GET /api/faturamento/projecao?vidas=N&taxa=20</b>.', S['body']))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # 11. CREDENCIAIS DE DEMONSTRAÇÃO
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('11', 'Acesso Demo e Credenciais',
        'Ambiente de demonstração disponível para avaliação'))
    story.append(Spacer(1, 5*mm))

    story.append(Paragraph(
        'O sistema está disponível em ambiente de demonstração completo com dados reais '
        'de teste. Todas as funcionalidades estão ativas e operacionais.', S['body']))
    story.append(Spacer(1, 3*mm))

    cred_data = [
        ['Perfil', 'E-mail', 'Senha', 'Acesso'],
        ['Admin', 'admin@margempro.com.br', 'Admin@2024', 'Total — todos os módulos'],
        ['RH/Prefeitura', 'rh@prefeitura.sp.gov.br', 'RH@12345', 'Módulos RH: funcionários, margem, folha'],
        ['Banco Operador', 'operador@bb.com.br', 'Banco@123', 'Averbações e consultas do banco'],
    ]
    story.append(make_table(cred_data,
        [22*mm, 52*mm, 28*mm, CW - 102*mm]))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Repositório e Pull Request</b>', S['h3']))
    story.append(Paragraph(
        '• <b>GitHub:</b> https://github.com/gelcijosegrouptrig-cmyk/kainow-gestao<br/>'
        '• <b>PR Principal:</b> https://github.com/gelcijosegrouptrig-cmyk/kainow-gestao/pull/1<br/>'
        '• <b>Branch:</b> genspark_ai_developer → main<br/>'
        '• <b>Commit:</b> feat: MargemPRO v2.0 — sistema completo RH↔Banco + Billing por Transação', S['body']))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph('<b>Estrutura de Arquivos</b>', S['h3']))
    files_data = [
        ['Arquivo', 'Tamanho Aprox.', 'Função'],
        ['backend/src/database.js', '~25 KB', 'Schema SQLite + 15 tabelas + billing'],
        ['backend/src/routes/faturamento.js', '~35 KB', '16 endpoints de billing completos'],
        ['backend/src/routes/averbacoes.js', '~20 KB', 'CRUD + trigger de billing na aprovação'],
        ['backend/src/routes/oauth2.js', '~15 KB', 'Autenticação OAuth2 para bancos'],
        ['frontend/public/dashboard.html', '~350 KB', 'SPA com 60+ módulos e billing frontend'],
        ['backend/src/seed.js', '~8 KB', 'Dados iniciais de demonstração'],
    ]
    story.append(make_table(files_data,
        [65*mm, 30*mm, CW - 95*mm]))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════
    # CONTRACAPA / RESUMO EXECUTIVO
    # ══════════════════════════════════════════════════════════════════
    story.append(SectionHeader('✦', 'Resumo Executivo',
        'MargemPRO em uma página', AZUL_ESCURO))
    story.append(Spacer(1, 5*mm))

    summary = [
        ('O Problema', 'Prefeituras gerenciam margem consignável manualmente, com planilhas e processos lentos. Bancos não têm visibilidade em tempo real. Processos de averbação levam dias.'),
        ('A Solução', 'MargemPRO digitaliza 100% do processo: da consulta de margem à comprovação jurídica, em segundos, via API segura.'),
        ('Modelo de Negócio', 'Zero-cost RH: a prefeitura usa de graça. Os bancos pagam por averbação (R$15–R$25). Receita previsível, escalável e de baixo churn.'),
        ('Diferenciais Técnicos', 'OAuth2 PKCE, SHA-256 em comprovantes, RBAC completo, webhooks, eSocial, portabilidade, pré/pós-pago, multi-convênio — tudo pronto e funcionando.'),
        ('Potencial de Receita', 'Prefeitura com 10.000 servidores + 3 bancos = R$120.000/ano + manutenção. Escalável para R$1.2M com 100.000 vidas.'),
        ('Estado Atual', 'MVP v2.0 completo, testado end-to-end, com PR aberto no GitHub. Pronto para demo, homologação e contratação de bancos parceiros.'),
    ]

    for title, text in summary:
        row = [[
            Paragraph(title, ParagraphStyle('st', fontSize=9, fontName='Helvetica-Bold',
                textColor=BRANCO, alignment=TA_CENTER)),
            Paragraph(text, S['body'])
        ]]
        t = Table(row, colWidths=[35*mm, CW - 35*mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (0,0), AZUL_MEDIO),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('LINEBELOW', (0,0), (-1,-1), 0.5, HexColor('#E5E7EB')),
        ]))
        story.append(t)

    story.append(Spacer(1, 8*mm))
    story.append(HRFlowable(width=CW, color=AZUL_CLARO, thickness=2))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph(
        'MargemPRO  •  Sistema de Gestão de Margem Consignável  •  v2.0',
        ParagraphStyle('footer_title', fontSize=11, fontName='Helvetica-Bold',
            textColor=AZUL_ESCURO, alignment=TA_CENTER)))
    story.append(Paragraph(
        'Desenvolvido com Node.js + SQLite + OAuth2 + SHA-256  •  Abril de 2026',
        ParagraphStyle('footer_sub', fontSize=8, fontName='Helvetica',
            textColor=CINZA_MEDIO, alignment=TA_CENTER)))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        '<i>Este documento é confidencial e destinado exclusivamente aos destinatários autorizados. '
        'Reprodução ou distribuição não autorizada é proibida.</i>',
        ParagraphStyle('conf', fontSize=7.5, fontName='Helvetica-Oblique',
            textColor=CINZA_MEDIO, alignment=TA_CENTER)))

    # ── BUILD ──────────────────────────────────────────────────────────────────
    doc.build(story, canvasmaker=MargemPROCanvas)
    print(f'✅ PDF gerado: {output_path}')


if __name__ == '__main__':
    output = '/home/user/webapp/MargemPRO_Apresentacao.pdf'
    build_pdf(output)
