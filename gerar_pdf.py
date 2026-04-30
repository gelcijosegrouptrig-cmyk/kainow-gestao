from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                  TableStyle, HRFlowable, PageBreak, KeepTogether)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle, Polygon
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics import renderPDF
from reportlab.platypus.flowables import Flowable
import os

# ─── Paleta de cores ─────────────────────────────────────────────────────────
AZUL       = colors.HexColor('#1e40af')
AZUL_CLARO = colors.HexColor('#3b82f6')
AZUL_MUTED = colors.HexColor('#dbeafe')
VERDE      = colors.HexColor('#10b981')
VERDE_CLARO= colors.HexColor('#d1fae5')
AMARELO    = colors.HexColor('#f59e0b')
AMARELO_CL = colors.HexColor('#fef3c7')
ROXO       = colors.HexColor('#7c3aed')
ROXO_CLARO = colors.HexColor('#ede9fe')
VERMELHO   = colors.HexColor('#ef4444')
CINZA_ESC  = colors.HexColor('#1e293b')
CINZA_MED  = colors.HexColor('#475569')
CINZA_CLAR = colors.HexColor('#94a3b8')
CINZA_BG   = colors.HexColor('#f8fafc')
BRANCO     = colors.white
PRETO      = colors.black

W, H = A4  # 595.28 x 841.89

# ─── Estilos ──────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def estilo(name, **kwargs):
    base = kwargs.pop('parent', 'Normal')
    s = ParagraphStyle(name=name, parent=styles[base], **kwargs)
    return s

S = {
    'titulo_capa':  estilo('TituloCapa',  fontSize=36, textColor=BRANCO,
                            fontName='Helvetica-Bold', alignment=TA_CENTER, leading=44),
    'sub_capa':     estilo('SubCapa',     fontSize=16, textColor=colors.HexColor('#bfdbfe'),
                            fontName='Helvetica', alignment=TA_CENTER, leading=22),
    'h1':           estilo('H1',          fontSize=20, textColor=AZUL,
                            fontName='Helvetica-Bold', spaceBefore=6, spaceAfter=4, leading=26),
    'h2':           estilo('H2',          fontSize=14, textColor=CINZA_ESC,
                            fontName='Helvetica-Bold', spaceBefore=4, spaceAfter=3, leading=20),
    'h3':           estilo('H3',          fontSize=11, textColor=AZUL,
                            fontName='Helvetica-Bold', spaceBefore=3, spaceAfter=2, leading=15),
    'body':         estilo('Body',        fontSize=10, textColor=CINZA_MED,
                            fontName='Helvetica', leading=15, spaceAfter=4),
    'body_j':       estilo('BodyJ',       fontSize=10, textColor=CINZA_MED,
                            fontName='Helvetica', leading=15, spaceAfter=4, alignment=TA_JUSTIFY),
    'bullet':       estilo('Bullet',      fontSize=10, textColor=CINZA_MED,
                            fontName='Helvetica', leading=14, leftIndent=16, spaceAfter=3,
                            bulletIndent=4, bulletFontName='Helvetica', bulletFontSize=12),
    'kpi_val':      estilo('KpiVal',      fontSize=22, textColor=AZUL,
                            fontName='Helvetica-Bold', alignment=TA_CENTER, leading=26),
    'kpi_lbl':      estilo('KpiLbl',      fontSize=9,  textColor=CINZA_MED,
                            fontName='Helvetica', alignment=TA_CENTER, leading=12),
    'table_h':      estilo('TH',          fontSize=9,  textColor=BRANCO,
                            fontName='Helvetica-Bold', alignment=TA_CENTER, leading=12),
    'table_c':      estilo('TC',          fontSize=9,  textColor=CINZA_ESC,
                            fontName='Helvetica', leading=12),
    'table_c_ctr':  estilo('TCC',         fontSize=9,  textColor=CINZA_ESC,
                            fontName='Helvetica', alignment=TA_CENTER, leading=12),
    'tag':          estilo('Tag',         fontSize=8,  textColor=AZUL,
                            fontName='Helvetica-Bold', alignment=TA_CENTER),
    'footer':       estilo('Footer',      fontSize=8,  textColor=CINZA_CLAR,
                            fontName='Helvetica', alignment=TA_CENTER),
    'destaque':     estilo('Destaque',    fontSize=11, textColor=CINZA_ESC,
                            fontName='Helvetica-Bold', leading=16, spaceAfter=4),
    'numero_pg':    estilo('NumeroPg',    fontSize=8,  textColor=CINZA_CLAR,
                            fontName='Helvetica', alignment=TA_RIGHT),
    'verde_bold':   estilo('VerdeBold',   fontSize=10, textColor=VERDE,
                            fontName='Helvetica-Bold', leading=14),
    'code':         estilo('Code',        fontSize=8,  textColor=colors.HexColor('#1e3a5f'),
                            fontName='Courier', leading=12, leftIndent=10,
                            backColor=colors.HexColor('#eff6ff'), spaceBefore=4, spaceAfter=4),
}

# ─── Flowables customizados ────────────────────────────────────────────────────

class CapaHeader(Flowable):
    """Bloco de capa com gradiente simulado."""
    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        # Fundo principal
        c.setFillColor(AZUL)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        # Faixas decorativas
        c.setFillColor(colors.HexColor('#1d4ed8'))
        c.rect(0, self.height*0.55, self.width, self.height*0.45, fill=1, stroke=0)
        # Círculos decorativos
        c.setFillColor(colors.HexColor('#2563eb'), )
        c.setFillAlpha(0.4)
        c.circle(self.width*0.85, self.height*0.8, 90, fill=1, stroke=0)
        c.setFillAlpha(0.25)
        c.circle(self.width*0.9, self.height*0.3, 60, fill=1, stroke=0)
        c.setFillAlpha(0.15)
        c.circle(self.width*0.05, self.height*0.6, 80, fill=1, stroke=0)
        c.setFillAlpha(1)

class BandaCorpo(Flowable):
    """Faixa colorida horizontal."""
    def __init__(self, width, height, cor, radius=6):
        Flowable.__init__(self)
        self.width  = width
        self.height = height
        self.cor    = cor
        self.radius = radius

    def draw(self):
        c = self.canv
        c.setFillColor(self.cor)
        c.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=0)

class SectionHeader(Flowable):
    """Cabeçalho de seção com barra colorida + número."""
    def __init__(self, numero, titulo, cor=AZUL, width=None):
        Flowable.__init__(self)
        self.numero = numero
        self.titulo = titulo
        self.cor    = cor
        self.width  = width or (W - 4*cm)
        self.height = 36

    def draw(self):
        c = self.canv
        # Barra esquerda
        c.setFillColor(self.cor)
        c.rect(0, 0, 6, self.height, fill=1, stroke=0)
        # Círculo com número
        c.setFillColor(self.cor)
        c.circle(22, self.height/2, 14, fill=1, stroke=0)
        c.setFillColor(BRANCO)
        c.setFont('Helvetica-Bold', 11)
        c.drawCentredString(22, self.height/2 - 4, str(self.numero))
        # Título
        c.setFillColor(CINZA_ESC)
        c.setFont('Helvetica-Bold', 16)
        c.drawString(44, self.height/2 - 5, self.titulo)
        # Linha decorativa
        c.setStrokeColor(colors.HexColor('#e2e8f0'))
        c.setLineWidth(1)
        c.line(44, 4, self.width, 4)

class CardKpi(Flowable):
    """Card KPI colorido."""
    def __init__(self, valor, label, cor, icone='', width=110, height=70):
        Flowable.__init__(self)
        self.valor  = valor
        self.label  = label
        self.cor    = cor
        self.icone  = icone
        self.width  = width
        self.height = height

    def draw(self):
        c = self.canv
        # Fundo arredondado
        c.setFillColor(self.cor)
        c.roundRect(0, 0, self.width, self.height, 8, fill=1, stroke=0)
        # Ícone
        c.setFillColor(BRANCO)
        c.setFont('Helvetica', 18)
        c.drawCentredString(self.width/2, self.height - 26, self.icone)
        # Valor
        c.setFont('Helvetica-Bold', 15)
        c.setFillColor(BRANCO)
        c.drawCentredString(self.width/2, self.height - 44, self.valor)
        # Label
        c.setFont('Helvetica', 7)
        c.setFillColor(colors.HexColor('#ffffff'))
        c.setFillAlpha(0.85)
        c.drawCentredString(self.width/2, self.height - 56, self.label)
        c.setFillAlpha(1)

class FluxoArrow(Flowable):
    """Diagrama de fluxo horizontal."""
    def __init__(self, passos, cores, width=None, height=60):
        Flowable.__init__(self)
        self.passos = passos
        self.cores  = cores
        self.width  = width or (W - 4*cm)
        self.height = height

    def draw(self):
        c = self.canv
        n = len(self.passos)
        box_w = (self.width - (n-1)*14) / n
        box_h = self.height - 10
        y0 = 5

        for i, (passo, cor) in enumerate(zip(self.passos, self.cores)):
            x0 = i * (box_w + 14)
            # Caixa
            c.setFillColor(cor)
            c.roundRect(x0, y0, box_w, box_h, 6, fill=1, stroke=0)
            # Número
            c.setFillColor(BRANCO)
            c.setFont('Helvetica-Bold', 8)
            c.drawString(x0 + 6, y0 + box_h - 14, str(i+1))
            # Texto
            c.setFont('Helvetica', 7.5)
            lines = passo.split('\n')
            ly = y0 + box_h/2 + (len(lines)-1)*5
            for line in lines:
                c.drawCentredString(x0 + box_w/2, ly, line)
                ly -= 11
            # Seta
            if i < n - 1:
                ax = x0 + box_w + 2
                ay = y0 + box_h/2
                c.setFillColor(CINZA_CLAR)
                c.setStrokeColor(CINZA_CLAR)
                c.setLineWidth(1.5)
                c.line(ax, ay, ax + 10, ay)
                # Ponta de seta
                c.setFillColor(CINZA_CLAR)
                pts = [ax+10, ay, ax+6, ay+3, ax+6, ay-3]
                p = c.beginPath()
                p.moveTo(ax+10, ay)
                p.lineTo(ax+6, ay+3)
                p.lineTo(ax+6, ay-3)
                p.close()
                c.drawPath(p, fill=1, stroke=0)

class BarChart(Flowable):
    """Mini gráfico de barras de projeção."""
    def __init__(self, dados, labels, cor=AZUL, width=None, height=120):
        Flowable.__init__(self)
        self.dados  = dados
        self.labels = labels
        self.cor    = cor
        self.width  = width or (W - 4*cm)
        self.height = height

    def draw(self):
        c = self.canv
        n = len(self.dados)
        mx = max(self.dados)
        bar_w = (self.width - 40) / n - 6
        base_y = 30

        # Linhas de grade
        for i in range(4):
            gy = base_y + (self.height - base_y - 10) * i / 3
            c.setStrokeColor(colors.HexColor('#e2e8f0'))
            c.setLineWidth(0.5)
            c.line(30, gy, self.width, gy)

        for i, (val, lbl) in enumerate(zip(self.dados, self.labels)):
            x0 = 35 + i * (bar_w + 6)
            bh = (val / mx) * (self.height - base_y - 15)
            # Barra gradiente (simulado com 2 retângulos)
            c.setFillColor(colors.HexColor('#93c5fd'))
            c.roundRect(x0, base_y, bar_w, bh, 3, fill=1, stroke=0)
            c.setFillColor(self.cor)
            c.roundRect(x0, base_y, bar_w, bh*0.7, 3, fill=1, stroke=0)
            # Valor
            c.setFillColor(CINZA_ESC)
            c.setFont('Helvetica-Bold', 6.5)
            c.drawCentredString(x0 + bar_w/2, base_y + bh + 3, f'R${val:,.0f}' if val >= 1000 else f'R${val:.0f}')
            # Label
            c.setFillColor(CINZA_MED)
            c.setFont('Helvetica', 6.5)
            c.drawCentredString(x0 + bar_w/2, 14, lbl)
            c.drawCentredString(x0 + bar_w/2, 5, 'mês')

class CheckList(Flowable):
    """Lista de checklist visual."""
    def __init__(self, items, cor=VERDE, width=None):
        Flowable.__init__(self)
        self.items = items
        self.cor   = cor
        self.width = width or (W - 4*cm)
        self.height = len(items) * 18 + 6

    def draw(self):
        c = self.canv
        for i, item in enumerate(self.items):
            y = self.height - (i+1)*18
            # Círculo check
            c.setFillColor(self.cor)
            c.circle(8, y + 6, 7, fill=1, stroke=0)
            c.setFillColor(BRANCO)
            c.setFont('Helvetica-Bold', 9)
            c.drawCentredString(8, y + 3, '✓')
            # Texto
            c.setFillColor(CINZA_ESC)
            c.setFont('Helvetica', 9.5)
            c.drawString(22, y + 2, item)

# ─── Gerador de página ────────────────────────────────────────────────────────

def build_page_header(canvas, doc):
    """Rodapé / cabeçalho de páginas internas."""
    canvas.saveState()
    # Linha topo
    canvas.setStrokeColor(AZUL_MUTED)
    canvas.setLineWidth(2)
    canvas.line(2*cm, H - 1.4*cm, W - 2*cm, H - 1.4*cm)
    # Logo texto topo
    canvas.setFillColor(AZUL)
    canvas.setFont('Helvetica-Bold', 9)
    canvas.drawString(2*cm, H - 1.15*cm, 'MargemPRO')
    canvas.setFillColor(CINZA_CLAR)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(2*cm + 62, H - 1.15*cm, '— Sistema de Gestão de Margem Consignável')
    # Número de página
    canvas.setFillColor(CINZA_CLAR)
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(W - 2*cm, H - 1.15*cm, f'Página {doc.page}')
    # Rodapé
    canvas.setStrokeColor(AZUL_MUTED)
    canvas.setLineWidth(1)
    canvas.line(2*cm, 1.4*cm, W - 2*cm, 1.4*cm)
    canvas.setFillColor(CINZA_CLAR)
    canvas.setFont('Helvetica', 7.5)
    canvas.drawCentredString(W/2, 1.0*cm, 'Documento Confidencial — MargemPRO v2.0 © 2026 — Todos os direitos reservados')
    canvas.restoreState()

def build_capa(canvas, doc):
    """Página de capa especial."""
    canvas.saveState()
    # Fundo
    canvas.setFillColor(AZUL)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # Faixa superior mais escura
    canvas.setFillColor(colors.HexColor('#1d4ed8'))
    canvas.rect(0, H*0.52, W, H*0.48, fill=1, stroke=0)
    # Círculos decorativos
    canvas.setFillColor(colors.HexColor('#2563eb'))
    canvas.setFillAlpha(0.35)
    canvas.circle(W*0.88, H*0.82, 110, fill=1, stroke=0)
    canvas.setFillAlpha(0.20)
    canvas.circle(W*0.92, H*0.25, 70, fill=1, stroke=0)
    canvas.setFillAlpha(0.12)
    canvas.circle(W*0.05, H*0.65, 90, fill=1, stroke=0)
    canvas.setFillAlpha(0.08)
    canvas.circle(W*0.15, H*0.1, 120, fill=1, stroke=0)
    canvas.setFillAlpha(1)
    # Faixa verde inferior
    canvas.setFillColor(VERDE)
    canvas.rect(0, 0, W, 0.8*cm, fill=1, stroke=0)
    # Tag versão
    canvas.setFillColor(colors.HexColor('#1e3a8a'))
    canvas.roundRect(2*cm, H - 2.2*cm, 3.2*cm, 0.7*cm, 4, fill=1, stroke=0)
    canvas.setFillColor(AMARELO)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawString(2.3*cm, H - 1.88*cm, 'VERSÃO 2.0  |  2026')
    # Ícone principal (símbolo $)
    canvas.setFillColor(colors.HexColor('#60a5fa'))
    canvas.setFillAlpha(0.25)
    canvas.circle(W/2, H*0.68, 80, fill=1, stroke=0)
    canvas.setFillAlpha(1)
    canvas.setFillColor(BRANCO)
    canvas.setFont('Helvetica-Bold', 60)
    canvas.drawCentredString(W/2, H*0.655, '₿M')
    # Título
    canvas.setFillColor(BRANCO)
    canvas.setFont('Helvetica-Bold', 42)
    canvas.drawCentredString(W/2, H*0.52, 'MargemPRO')
    canvas.setFillColor(colors.HexColor('#93c5fd'))
    canvas.setFont('Helvetica', 17)
    canvas.drawCentredString(W/2, H*0.49, 'Sistema de Gestão de Margem Consignável')
    # Subtítulo
    canvas.setFillColor(colors.HexColor('#bfdbfe'))
    canvas.setFont('Helvetica', 12)
    canvas.drawCentredString(W/2, H*0.44, 'Billing por Transação  ·  RH↔Banco  ·  Comprovantes SHA-256')
    # Linha divisória
    canvas.setStrokeColor(colors.HexColor('#3b82f6'))
    canvas.setLineWidth(2)
    canvas.line(3*cm, H*0.40, W - 3*cm, H*0.40)
    # KPIs na capa
    kpis = [
        ('16 endpoints', 'API REST'),
        ('5 tabelas', 'Billing DB'),
        ('SHA-256', 'Comprovantes'),
        ('0 custo', 'para o RH'),
    ]
    kw = (W - 4*cm) / 4
    for i, (v, l) in enumerate(kpis):
        x = 2*cm + i*kw + kw/2
        canvas.setFillColor(colors.HexColor('#1e3a8a'))
        canvas.roundRect(x - kw/2 + 4, H*0.30, kw - 8, 0.95*cm, 6, fill=1, stroke=0)
        canvas.setFillColor(AMARELO)
        canvas.setFont('Helvetica-Bold', 11)
        canvas.drawCentredString(x, H*0.30 + 0.55*cm, v)
        canvas.setFillColor(colors.HexColor('#93c5fd'))
        canvas.setFont('Helvetica', 8)
        canvas.drawCentredString(x, H*0.30 + 0.18*cm, l)
    # Info rodapé capa
    canvas.setFillColor(BRANCO)
    canvas.setFont('Helvetica', 9)
    canvas.drawCentredString(W/2, H*0.24, 'Apresentação Executiva & Manual de Funcionamento')
    canvas.setFillColor(colors.HexColor('#93c5fd'))
    canvas.setFont('Helvetica', 8)
    canvas.drawCentredString(W/2, H*0.21, 'Documento gerado automaticamente em Abril / 2026')
    canvas.restoreState()

# ─── Construção do documento ──────────────────────────────────────────────────

OUTPUT = '/home/user/webapp/MargemPRO_Apresentacao.pdf'
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2.2*cm, bottomMargin=2*cm,
    title='MargemPRO v2.0 — Apresentação Executiva',
    author='MargemPRO',
    subject='Sistema de Gestão de Margem Consignável com Billing por Transação',
)

story = []

# ═══════════════════════════════════════════════════════
# CAPA (página em branco — a capa é desenhada no onPage)
# ═══════════════════════════════════════════════════════
story.append(Spacer(1, H - 4*cm))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 2 — ÍNDICE / SUMÁRIO
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(0, 'Sumário', CINZA_MED))
story.append(Spacer(1, 0.4*cm))

indice_data = [
    ['01', 'O que é o MargemPRO',                '03'],
    ['02', 'O Problema que Resolvemos',           '04'],
    ['03', 'Arquitetura do Sistema',              '05'],
    ['04', 'Como Funciona — Fluxo Completo',      '06'],
    ['05', 'Módulo RH — Folha de Pagamento',      '07'],
    ['06', 'Módulo Banco — API OAuth2',           '08'],
    ['07', 'Sistema de Faturamento (Billing)',    '09'],
    ['08', 'Modelos de Cobrança',                 '10'],
    ['09', 'Comprovante Digital SHA-256',         '11'],
    ['10', 'Fechamento de Ciclo',                 '12'],
    ['11', 'Projeção de Receita',                 '13'],
    ['12', 'Segurança e Compliance',              '14'],
    ['13', 'Perguntas Frequentes (FAQ)',          '15'],
    ['14', 'Próximos Passos',                     '16'],
]
for num, titulo, pg in indice_data:
    row_data = [[
        Paragraph(f'<b>{num}</b>', S['table_c_ctr']),
        Paragraph(titulo, S['table_c']),
        Paragraph(pg, S['table_c_ctr']),
    ]]
    t = Table(row_data, colWidths=[1.2*cm, 12.3*cm, 1.5*cm])
    cor_linha = AZUL_MUTED if int(num) % 2 == 0 else BRANCO
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), cor_linha),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [cor_linha]),
        ('LEFTPADDING',  (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING',   (0,0), (-1,-1), 5),
        ('BOTTOMPADDING',(0,0), (-1,-1), 5),
        ('ROUNDEDCORNERS', [4]),
    ]))
    story.append(t)
    story.append(Spacer(1, 2))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 3 — O QUE É O MARGEMPRO
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(1, 'O que é o MargemPRO'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'O <b>MargemPRO</b> é uma plataforma SaaS de gestão de margem consignável que conecta '
    '<b>prefeituras / órgãos públicos (RH)</b> a <b>instituições financeiras (Bancos)</b>, '
    'automatizando todo o ciclo de averbação: da importação da folha de pagamento até a '
    'geração de comprovantes digitais com prova criptográfica.',
    S['body_j']))

story.append(Spacer(1, 0.3*cm))

# Box destaque
t = Table([[Paragraph(
    '💡 <b>Proposta de valor:</b> O RH não paga nada. O banco paga apenas quando uma '
    'averbação é <u>efetivamente aprovada</u>. Sem custo para o poder público.',
    S['body'])]], colWidths=[W - 4*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), AMARELO_CL),
    ('BOX', (0,0), (-1,-1), 1.5, AMARELO),
    ('ROUNDEDCORNERS', [6]),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(t)
story.append(Spacer(1, 0.4*cm))

# 3 colunas: Quem usa
col_data = [[
    Table([[
        [Paragraph('🏛️', S['h1'])],
        [Paragraph('Prefeituras / RH', S['h3'])],
        [Paragraph('Importa folha, valida margem, aprova ou recusa averbações. Usa gratuitamente.', S['body'])],
    ]], colWidths=[4.8*cm], style=TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), AZUL_MUTED),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('ROUNDEDCORNERS', [8]),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ])),
    Table([[
        [Paragraph('🏦', S['h1'])],
        [Paragraph('Bancos / Financeiras', S['h3'])],
        [Paragraph('Consulta margem via API OAuth2, reserva e efetiva contratos. Paga por transação.', S['body'])],
    ]], colWidths=[4.8*cm], style=TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), VERDE_CLARO),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('ROUNDEDCORNERS', [8]),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ])),
    Table([[
        [Paragraph('📊', S['h1'])],
        [Paragraph('Gestão / Admin', S['h3'])],
        [Paragraph('Configura tarifas, fecha ciclos mensais, gera faturas, monitora receita e compliance.', S['body'])],
    ]], colWidths=[4.8*cm], style=TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), ROXO_CLARO),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('ROUNDEDCORNERS', [8]),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ])),
]]
t2 = Table(col_data, colWidths=[4.9*cm, 4.9*cm, 4.9*cm])
t2.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('LEFTPADDING', (0,0), (-1,-1), 0), ('RIGHTPADDING', (0,0), (-1,-1), 5)]))
story.append(t2)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 4 — O PROBLEMA
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(2, 'O Problema que Resolvemos', VERMELHO))
story.append(Spacer(1, 0.4*cm))

problemas = [
    ('❌ Processos manuais', 'RH valida margem em planilhas Excel. Erros, retrabalho e risco de fraude são constantes.'),
    ('❌ Falta de integração', 'Bancos ligam para RH, RH consulta papel, prazo de 5 dias úteis para confirmar uma averbação.'),
    ('❌ Sem rastreabilidade', 'Não há registro digital imutável de quem aprovou, quando e qual valor foi comprometido.'),
    ('❌ Billing opaco', 'Bancos não sabem quanto devem ao operador do sistema. Cobranças manuais com alto risco de erro.'),
    ('❌ Risco de superfaturamento', 'Sem comprovante criptográfico, disputas entre bancos e RH são resolvidas na base da planilha.'),
]

for icon_titulo, desc in problemas:
    t = Table([[
        Paragraph(icon_titulo, S['destaque']),
        Paragraph(desc, S['body']),
    ]], colWidths=[4.5*cm, 10.5*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#fff5f5')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#fecaca')),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ROUNDEDCORNERS', [4]),
    ]))
    story.append(t)
    story.append(Spacer(1, 4))

story.append(Spacer(1, 0.3*cm))
story.append(Paragraph('✅  <b>O MargemPRO resolve tudo isso:</b>', S['h2']))

solucoes = [
    'Importação automática de folha (CSV, CNAB240, TOTVS, SAP, SENIOR)',
    'API OAuth2 para bancos consultarem margem em segundos, sem ligações',
    'Comprovante SHA-256 imutável para cada averbação aprovada',
    'Billing automático por transação: ciclo mensal, fatura, relatório',
    'Audit log completo (LGPD) com rastreabilidade de todas as ações',
]
story.append(CheckList(solucoes, VERDE))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 5 — ARQUITETURA
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(3, 'Arquitetura do Sistema'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'O MargemPRO é construído como uma <b>API REST Node.js</b> com banco de dados SQLite '
    '(modo WAL para alta performance) e frontend HTML/JS puro, servido pelo próprio '
    'Express. Toda a segurança é gerenciada por <b>JWT + OAuth2 client_credentials</b>.',
    S['body_j']))

story.append(Spacer(1, 0.3*cm))

# Tabela de componentes
arq_data = [
    [Paragraph('<b>Camada</b>', S['table_h']),
     Paragraph('<b>Tecnologia</b>', S['table_h']),
     Paragraph('<b>Função</b>', S['table_h'])],
    ['Backend API', 'Node.js 20 + Express 4', '17 módulos de rotas, middleware de segurança, rate limiting'],
    ['Banco de Dados', 'SQLite 3 (WAL mode)', '25+ tabelas, índices otimizados, transações atômicas'],
    ['Autenticação', 'JWT (usuários) + OAuth2 (bancos)', 'client_credentials para API bancária, JWT para dashboard'],
    ['Frontend', 'HTML5 + JS vanilla', 'SPA servida pelo Express, 60+ seções, 136+ funções JS'],
    ['Segurança', 'Helmet + CORS + Rate Limit', 'CSP, CORS configurável, 500 req/s global, 20 req/s login'],
    ['Webhooks', 'Fila interna + retry', 'Notificações em tempo real para bancos e RH'],
    ['Criptografia', 'SHA-256 (Node crypto)', 'Comprovantes imutáveis por averbação'],
    ['Integração RH', 'CSV / CNAB240 / TOTVS / SAP', 'Parser automático de formato, importação com preview'],
]
t = Table(arq_data, colWidths=[3.5*cm, 4.5*cm, 7*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), AZUL),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, CINZA_BG]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('FONT', (0,1), (-1,-1), 'Helvetica', 8.5),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 6 — FLUXO COMPLETO
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(4, 'Como Funciona — Fluxo Completo'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph('<b>Fluxo RH → Banco → Averbação → Billing</b>', S['h2']))
story.append(Spacer(1, 0.2*cm))

passos_fluxo = [
    'RH importa\nfolha CSV\nou CNAB',
    'Sistema calcula\nmargem por\nfuncionário',
    'Banco consulta\nmargem via\nOAuth2 API',
    'Banco reserva\nmargem\n(RESERVADA)',
    'RH aprova\na averbação\n(APROVADA)',
    'Billing\nautomático\ndisparado',
    'Ciclo mensal\natualizado\n+ Hash SHA256',
    'Admin fecha\nciclo → gera\nfatura',
]
cores_fluxo = [AZUL, AZUL_CLARO, VERDE, VERDE,
               colors.HexColor('#f59e0b'), ROXO, ROXO, CINZA_ESC]
story.append(FluxoArrow(passos_fluxo, cores_fluxo, width=W - 4*cm, height=70))

story.append(Spacer(1, 0.5*cm))

# Detalhe por etapa
etapas = [
    ('1–2', 'Importação e Cálculo de Margem', AZUL,
     'O RH faz upload de arquivo CSV/CNAB240 via `/api/rh/sincronizar` ou `/api/importacoes/upload`. '
     'O sistema detecta o formato automaticamente (TOTVS, SAP, SENIOR, CSV), processa cada funcionário, '
     'calcula margem consignável (35% do líquido para empréstimo, 5% para cartão/benefício) e '
     'atualiza a tabela `margens` com competência do mês.'),
    ('3–4', 'Consulta e Reserva Bancária', VERDE,
     'O banco autentica via OAuth2 (`/v1/oauth2/token`) e consulta a margem do funcionário '
     '(`/v1/margem/consultar`). Ao encontrar margem disponível, cria uma averbação via '
     '`/api/averbacoes` — status inicial: **RESERVADA**. A margem é bloqueada atomicamente no SQLite.'),
    ('5–6', 'Aprovação + Trigger de Billing', ROXO,
     'O RH revisa as reservas pendentes em "Reservas RH" e aprova via `PATCH /api/averbacoes/:id/aprovar`. '
     'No mesmo instante, `dispararBilling()` é chamado automaticamente: determina a tarifa '
     '(banco×convênio → banco → padrão), cria/atualiza o ciclo mensal, insere o item com hash '
     'SHA-256 e, se pré-pago, debita o saldo — tudo em uma única transação SQLite.'),
    ('7–8', 'Fechamento de Ciclo e Fatura', AMARELO,
     'O admin acessa "Fechamento de Ciclo", revisa os totais do mês e clica em "Faturar". '
     'O sistema gera um número de fatura único (ex: FAT-202604-5F4D-CDZS), registra a data '
     'de vencimento (dia 5 do mês seguinte para pós-pago) e disponibiliza exportação em '
     'JSON ou CSV com hash de integridade por linha.'),
]
for nums, titulo, cor, desc in etapas:
    inner = Table([[
        Table([[
            [Paragraph(f'Etapas {nums}', S['tag'])],
        ]], colWidths=[1.8*cm], style=TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), cor),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('ROUNDEDCORNERS', [4]),
        ])),
        Table([[
            [Paragraph(titulo, S['h3'])],
            [Paragraph(desc, S['body'])],
        ]], colWidths=[12.5*cm], style=TableStyle([
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('TOPPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ])),
    ]], colWidths=[2*cm, 12.8*cm])
    inner.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CINZA_BG),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROUNDEDCORNERS', [4]),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(inner)
    story.append(Spacer(1, 5))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 7 — MÓDULO RH
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(5, 'Módulo RH — Folha de Pagamento'))
story.append(Spacer(1, 0.4*cm))

rh_endpoints = [
    ['Endpoint', 'Método', 'Função'],
    ['/api/rh/sincronizar', 'POST', 'Sincroniza funcionários e calcula margens'],
    ['/api/rh/reservas', 'GET', 'Lista averbações pendentes de aprovação pelo RH'],
    ['/api/rh/reservas/:id/aprovar', 'POST', 'Aprova averbação → dispara billing'],
    ['/api/rh/reservas/:id/cancelar', 'POST', 'Cancela e devolve margem ao funcionário'],
    ['/api/rh/exportar-descontos', 'GET', 'Gera arquivo de descontos (CSV/CNAB240/TXT)'],
    ['/api/rh/resumo-descontos', 'GET', 'Resumo consolidado de descontos do mês'],
    ['/api/rh/relatorio-margem', 'GET', 'Relatório de margem por convênio'],
    ['/api/rh/sincronizacoes', 'GET', 'Histórico de sincronizações de folha'],
    ['/api/importacoes/upload', 'POST', 'Upload de arquivo folha (multipart)'],
    ['/api/importacoes/template/:fmt', 'GET', 'Template CSV/TOTVS/SAP para download'],
]
t = Table(rh_endpoints, colWidths=[6.5*cm, 2.5*cm, 6*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), VERDE),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, VERDE_CLARO]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#d1fae5')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('FONT', (0,1), (-1,-1), 'Courier', 8),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t)

story.append(Spacer(1, 0.4*cm))
story.append(Paragraph('<b>Formato do CSV de sincronização:</b>', S['h3']))
story.append(Paragraph(
    'matricula;cpf;nome;salario_bruto;salario_liquido;situacao;cargo;lotacao',
    S['code']))
story.append(Paragraph(
    '12345;12345678901;João Silva;4500.00;3200.00;ATIVO;Analista;Secretaria de Saúde',
    S['code']))

story.append(Spacer(1, 0.3*cm))
story.append(Paragraph('<b>Situações válidas dos funcionários:</b>', S['h3']))
sits = [
    ('ATIVO', VERDE, 'Pode averbар'),
    ('INATIVO', CINZA_CLAR, 'Bloqueado'),
    ('AFASTADO', AMARELO, 'Bloqueado'),
    ('LICENCIADO', AMARELO, 'Bloqueado'),
    ('DEMITIDO', VERMELHO, 'Bloqueado'),
    ('APOSENTADO', CINZA_MED, 'Bloqueado'),
]
sit_row = [[
    Table([[
        [Paragraph(s, S['tag'])],
    ]], colWidths=[2.4*cm], style=TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('ROUNDEDCORNERS', [4]),
    ]))
    for s, c, _ in sits
]]
t2 = Table(sit_row, colWidths=[2.5*cm]*6)
t2.setStyle(TableStyle([('LEFTPADDING', (0,0), (-1,-1), 2), ('RIGHTPADDING', (0,0), (-1,-1), 2)]))
story.append(t2)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 8 — MÓDULO BANCO
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(6, 'Módulo Banco — API OAuth2'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'Os bancos se integram via <b>OAuth2 client_credentials</b>. Cada banco recebe um '
    '<code>client_id</code> e <code>client_secret</code> cadastrados pelo admin. '
    'O token é válido por 1 hora e carrega os escopos de permissão.',
    S['body_j']))
story.append(Spacer(1, 0.3*cm))

story.append(Paragraph('<b>Passo 1 — Obter Token OAuth2</b>', S['h3']))
story.append(Paragraph(
    'POST /v1/oauth2/token\n'
    'Body: { "grant_type": "client_credentials",\n'
    '        "client_id": "banco-bb-prod",\n'
    '        "client_secret": "s3cr3t..." }\n'
    'Resposta: { "access_token": "eyJ...", "expires_in": 3600 }',
    S['code']))

story.append(Paragraph('<b>Passo 2 — Consultar Margem</b>', S['h3']))
story.append(Paragraph(
    'POST /v1/margem/consultar\n'
    'Auth: Bearer <access_token>\n'
    'Body: { "cpf": "12345678901", "tipo": "EMPRESTIMO" }\n'
    'Resposta: { "cpf": "123.***.901", "margem_disponivel": 1120.00,\n'
    '            "margem_comprometida": 350.00, "salario_liquido": 4200.00 }',
    S['code']))

story.append(Paragraph('<b>Passo 3 — Criar Averbação (Reservar Margem)</b>', S['h3']))
story.append(Paragraph(
    'POST /api/averbacoes\n'
    'Body: { "funcionario_id": "uuid", "banco_id": "uuid",\n'
    '        "tipo": "EMPRESTIMO", "valor_parcela": 450.00, "prazo_meses": 36 }\n'
    'Resposta: { "id": "uuid", "codigo_averbacao": "PRE-202604-XXXX",\n'
    '            "status": "RESERVADA", "taxa_averbacao_cobrada": 20.00 }',
    S['code']))

story.append(Spacer(1, 0.3*cm))

banco_eps = [
    ['Endpoint', 'Método', 'Escopo', 'Descrição'],
    ['/v1/oauth2/token', 'POST', 'público', 'Obter token de acesso'],
    ['/v1/margem/consultar', 'POST', 'margem:consultar', 'Consultar margem disponível por CPF'],
    ['/v1/margem/extrato', 'POST', 'margem:consultar', 'Extrato de averbações do funcionário'],
    ['/v1/reserva/criar', 'POST', 'reserva:criar', 'Criar reserva de margem'],
    ['/v1/reserva/cancelar', 'POST', 'reserva:criar', 'Cancelar reserva pendente'],
    ['/v1/averbacao/efetivar', 'POST', 'averbacao:efetivar', 'Efetivar averbação confirmada'],
    ['/v1/averbacao/consultar', 'POST', 'averbacao:efetivar', 'Consultar status de averbação'],
]
t = Table(banco_eps, colWidths=[5.5*cm, 2*cm, 3*cm, 4.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), CINZA_ESC),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, CINZA_BG]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 8.5),
    ('FONT', (0,1), (-1,-1), 'Courier', 7.5),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 9 — BILLING
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(7, 'Sistema de Faturamento (Billing)'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'O billing é <b>100% automático</b> e orientado a eventos. Quando uma averbação muda '
    'para <b>APROVADA</b>, o sistema registra o faturamento sem nenhuma ação manual.',
    S['body_j']))
story.append(Spacer(1, 0.3*cm))

# Diagrama trigger
trigger_data = [[
    Paragraph('PATCH\n/api/averbacoes/:id/aprovar', S['code']),
    Paragraph('→', S['h1']),
    Paragraph('dispararBilling()\n(automático)', S['code']),
    Paragraph('→', S['h1']),
    Paragraph('Ciclo + Item\n+ Comprovante\n+ Débito Pré-pago', S['code']),
]]
t = Table(trigger_data, colWidths=[5*cm, 0.8*cm, 4.5*cm, 0.8*cm, 4*cm])
t.setStyle(TableStyle([
    ('ALIGN', (1,0), (1,0), 'CENTER'),
    ('ALIGN', (3,0), (3,0), 'CENTER'),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('BACKGROUND', (0,0), (0,0), colors.HexColor('#eff6ff')),
    ('BACKGROUND', (2,0), (2,0), colors.HexColor('#fef3c7')),
    ('BACKGROUND', (4,0), (4,0), colors.HexColor('#f0fdf4')),
    ('BOX', (0,0), (0,0), 1, AZUL_CLARO),
    ('BOX', (2,0), (2,0), 1, AMARELO),
    ('BOX', (4,0), (4,0), 1, VERDE),
    ('ROUNDEDCORNERS', [4]),
    ('TOPPADDING', (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
]))
story.append(t)

story.append(Spacer(1, 0.4*cm))

# Tabela de tabelas billing
story.append(Paragraph('<b>Tabelas de Billing no Banco de Dados</b>', S['h2']))
fat_tabelas = [
    ['Tabela', 'Campos-chave', 'Finalidade'],
    ['tarifas_banco_convenio', 'banco_id, convenio_id, valor_tarifa, modelo_cobranca', 'Tarifas negociadas por parceiro'],
    ['faturamento_ciclos', 'banco_id, competencia, status, valor_total, numero_fatura', 'Fechamento mensal por banco'],
    ['faturamento_itens', 'ciclo_id, averbacao_id, valor_tarifa, hash_comprovante', 'Itens faturáveis por averbação'],
    ['faturamento_creditos', 'banco_id, tipo, valor, saldo_antes, saldo_depois', 'Carteira pré-paga + movimentos'],
    ['faturamento_comprovantes', 'averbacao_id, numero_comprovante, hash_sha256, dados_json', 'Comprovantes imutáveis SHA-256'],
]
t = Table(fat_tabelas, colWidths=[4.5*cm, 7*cm, 3.5*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), ROXO),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, ROXO_CLARO]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('FONT', (0,1), (-1,-1), 'Courier', 7.5),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 10 — MODELOS DE COBRANÇA
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(8, 'Modelos de Cobrança'))
story.append(Spacer(1, 0.4*cm))

# 2 cards lado a lado
modelo_data = [[
    Table([[
        [Paragraph('📅 Pós-pago', S['h2'])],
        [Paragraph('Para bancos médios e grandes.', S['body'])],
        [Spacer(1, 4)],
        [CheckList([
            'Cobra ao final do mês',
            'Vencimento: dia 5 do mês seguinte',
            'Banco recebe fatura com todos os itens',
            'Pagamento por TED / PIX / Boleto',
            'Crédito ilimitado durante o mês',
        ], AZUL)],
    ]], colWidths=[7.3*cm], style=TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), AZUL_MUTED),
        ('BOX', (0,0), (-1,-1), 2, AZUL),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 12),
        ('BOTTOMPADDING', (0,0), (-1,-1), 12),
        ('ROUNDEDCORNERS', [8]),
    ])),
    Table([[
        [Paragraph('💳 Pré-pago', S['h2'])],
        [Paragraph('Para correspondentes e fintechs.', S['body'])],
        [Spacer(1, 4)],
        [CheckList([
            'Banco compra pacote de créditos',
            'Cada averbação consome do saldo',
            'Alerta quando saldo < R$100',
            'Bloqueio automático ao zerar',
            'Bônus/estorno gerenciados pelo admin',
        ], VERDE)],
    ]], colWidths=[7.3*cm], style=TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), VERDE_CLARO),
        ('BOX', (0,0), (-1,-1), 2, VERDE),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 12),
        ('BOTTOMPADDING', (0,0), (-1,-1), 12),
        ('ROUNDEDCORNERS', [8]),
    ])),
]]
t2 = Table(modelo_data, colWidths=[7.5*cm, 7.5*cm])
t2.setStyle(TableStyle([
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
    ('RIGHTPADDING', (0,0), (0,-1), 8),
]))
story.append(t2)

story.append(Spacer(1, 0.5*cm))

# Hierarquia de tarifas
story.append(Paragraph('<b>Hierarquia de Determinação de Tarifa:</b>', S['h3']))
hier = [
    ('1º', 'Tarifa banco × convênio específico',
     'Ex: Banco BB na Prefeitura SP = R$15,00'),
    ('2º', 'Tarifa geral do banco (todos os convênios)',
     'Ex: Banco BB (padrão) = R$18,00'),
    ('3º', 'taxa_averbacao na tabela bancos',
     'Cadastro inicial ao credenciar o banco'),
    ('4º', 'Valor padrão do sistema',
     'R$20,00 (configurável no código)'),
]
for n, titulo, exemplo in hier:
    row = [[
        Paragraph(n, S['kpi_val']),
        Table([[
            [Paragraph(titulo, S['destaque'])],
            [Paragraph(f'→ {exemplo}', S['body'])],
        ]], colWidths=[12*cm], style=TableStyle([
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ])),
    ]]
    t3 = Table(row, colWidths=[1.2*cm, 13.8*cm])
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CINZA_BG),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROUNDEDCORNERS', [4]),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(t3)
    story.append(Spacer(1, 3))

story.append(Spacer(1, 0.3*cm))
t4 = Table([[Paragraph(
    '🏛️ <b>Estratégia Zero-Cost RH:</b> Ofereça o sistema gratuitamente para a Prefeitura. '
    'Monetize via taxa de averbação dos bancos. Inclua cláusula contratual de manutenção '
    '(R$1/funcionário/mês × 48 meses) para garantir MRR independente do volume de averbações.',
    S['body'])]], colWidths=[W - 4*cm])
t4.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#fefce8')),
    ('BOX', (0,0), (-1,-1), 1.5, AMARELO),
    ('ROUNDEDCORNERS', [6]),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(t4)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 11 — COMPROVANTE DIGITAL
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(9, 'Comprovante Digital SHA-256'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'Cada averbação aprovada gera automaticamente um <b>comprovante digital imutável</b> '
    'assinado com SHA-256. O hash é calculado sobre os dados críticos da operação, '
    'garantindo prova jurídica em caso de disputas.',
    S['body_j']))
story.append(Spacer(1, 0.3*cm))

# Estrutura do hash
story.append(Paragraph('<b>Dados que compõem o Hash SHA-256:</b>', S['h3']))
hash_data = [
    ['Campo', 'Exemplo', 'Por quê é importante'],
    ['averbacao_id', 'uuid-v4', 'Identidade única da operação'],
    ['codigo_averbacao', 'PRE-202604-4B0C-FFF3', 'Código legível de rastreio'],
    ['banco', 'Banco do Brasil', 'Quem solicitou'],
    ['convenio', 'Prefeitura de São Paulo', 'De qual folha veio'],
    ['funcionario_cpf', '123.456.789-01', 'De quem é a margem'],
    ['valor_parcela', '450.00', 'Quanto foi comprometido'],
    ['prazo_meses', '36', 'Por quantos meses'],
    ['tarifa', '18.50', 'Quanto foi cobrado do banco'],
    ['timestamp', '2026-04-29T19:41:07Z', 'Quando aconteceu'],
]
t = Table(hash_data, colWidths=[3.5*cm, 4.5*cm, 7*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), CINZA_ESC),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, colors.HexColor('#f0f9ff')]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('FONT', (0,1), (0,-1), 'Courier', 8),
    ('FONT', (1,1), (1,-1), 'Courier', 8),
    ('FONT', (2,1), (2,-1), 'Helvetica', 8.5),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (1,-1), AZUL),
    ('TEXTCOLOR', (2,1), (2,-1), CINZA_MED),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t)

story.append(Spacer(1, 0.4*cm))
story.append(Paragraph('<b>Exemplo de Comprovante (resposta do endpoint):</b>', S['h3']))
story.append(Paragraph(
    'GET /api/faturamento/comprovante/{averbacao_id}\n\n'
    '{\n'
    '  "numero_comprovante": "CMP-MOKHUM3W-03G",\n'
    '  "timestamp_emissao":  "2026-04-29T19:41:22.000Z",\n'
    '  "integridade":        "VÁLIDA ✅",\n'
    '  "hash_sha256":        "5109c81e3c2bdc57ee27034e605c5cc4b4702dc8...",\n'
    '  "averbacao": { "codigo": "PRE-202604-4B0C-FFF3", "tipo": "EMPRESTIMO",\n'
    '                 "valor_parcela": 450.00, "prazo_meses": 36 },\n'
    '  "funcionario": { "nome": "Ana Paula Ferreira", "cpf": "123.***.789-01" },\n'
    '  "banco": { "nome": "Banco do Brasil" },\n'
    '  "faturamento": { "valor_tarifa": 18.50, "status": "VALIDO" }\n'
    '}',
    S['code']))

story.append(Spacer(1, 0.2*cm))
t5 = Table([[Paragraph(
    '⚖️ <b>Validade jurídica:</b> O hash SHA-256 do comprovante pode ser verificado '
    'independentemente por qualquer das partes (banco, RH ou regulador). Se o conteúdo '
    'for alterado, o hash não bate — prova de adulteração imediata.',
    S['body'])]], colWidths=[W - 4*cm])
t5.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), ROXO_CLARO),
    ('BOX', (0,0), (-1,-1), 1.5, ROXO),
    ('ROUNDEDCORNERS', [6]),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(t5)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 12 — FECHAMENTO DE CICLO
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(10, 'Fechamento de Ciclo'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'O <b>Fechamento de Ciclo</b> é o processo mensal de consolidação e cobrança. '
    'Cada banco tem seu próprio ciclo por competência (ex: 2026-04). '
    'O status avança linearmente:',
    S['body_j']))
story.append(Spacer(1, 0.3*cm))

ciclo_passos = ['ABERTO', 'FECHADO', 'FATURADO', 'PAGO']
ciclo_cores  = [AZUL_CLARO, AMARELO, VERDE, colors.HexColor('#6d28d9')]
story.append(FluxoArrow(ciclo_passos, ciclo_cores, width=W - 4*cm, height=55))

story.append(Spacer(1, 0.4*cm))

ciclo_desc = [
    ('ABERTO', AZUL_CLARO,
     'Ciclo criado automaticamente na primeira averbação do mês. '
     'Recebe novas averbações a qualquer momento. Total atualizado em tempo real.'),
    ('FECHADO', AMARELO,
     'Admin revisa os totais antes de emitir a fatura. '
     'Pode adicionar observações. Ainda não gera número de fatura.'),
    ('FATURADO', VERDE,
     'Admin clica em "Faturar". Sistema gera número único (FAT-AAAAMM-XXXX-XXXX), '
     'registra data de vencimento e disponibiliza exportação JSON/CSV.'),
    ('PAGO', colors.HexColor('#6d28d9'),
     'Admin registra o recebimento. Ciclo encerrado. '
     'Histórico permanente para auditoria e relatório anual.'),
]
for status, cor, desc in ciclo_desc:
    row = [[
        Table([[
            [Paragraph(status, S['tag'])],
        ]], colWidths=[2*cm], style=TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), cor),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('ROUNDEDCORNERS', [4]),
        ])),
        Paragraph(desc, S['body']),
    ]]
    t6 = Table(row, colWidths=[2.2*cm, 12.8*cm])
    t6.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CINZA_BG),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROUNDEDCORNERS', [4]),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(t6)
    story.append(Spacer(1, 4))

story.append(Spacer(1, 0.3*cm))
story.append(Paragraph('<b>Conteúdo da fatura exportada (JSON):</b>', S['h3']))
story.append(Paragraph(
    '{\n'
    '  "numero_fatura": "FAT-202604-5F4D-CDZS",\n'
    '  "banco": "Banco do Brasil",\n'
    '  "competencia": "2026-04",\n'
    '  "vencimento": "2026-05-05",\n'
    '  "total_averbacoes": 47,\n'
    '  "valor_total": 940.00,  // 47 × R$20\n'
    '  "clausula_manutencao": "R$1,00/func/mês × 48 meses",\n'
    '  "hash_integridade": "a3f9...",\n'
    '  "itens": [ { "codigo_averbacao": "PRE-...", "cpf": "123.***.01",\n'
    '               "taxa": 20.00, "hash": "5109..." }, ... ]\n'
    '}',
    S['code']))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 13 — PROJEÇÃO DE RECEITA
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(11, 'Projeção de Receita'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'A projeção usa como base: <b>5% das vidas averbam por mês</b> (taxa conservadora). '
    'Taxa por averbação de <b>R$20</b> (configurável por banco). '
    'Não inclui MRR de cláusula de manutenção.',
    S['body_j']))

story.append(Spacer(1, 0.3*cm))

# Tabela de projeção
proj_data = [
    ['Vidas (funcionários)', 'Avs/mês (5%)', 'Receita/mês', 'Receita/ano', 'Break-even*'],
    ['500', '25', 'R$ 500', 'R$ 6.000', '10 meses'],
    ['1.000', '50', 'R$ 1.000', 'R$ 12.000', '5 meses'],
    ['2.000', '100', 'R$ 2.000', 'R$ 24.000', '3 meses'],
    ['5.000', '250', 'R$ 5.000', 'R$ 60.000', '1 mês'],
    ['10.000', '500', 'R$ 10.000', 'R$ 120.000', '< 1 mês'],
    ['25.000', '1.250', 'R$ 25.000', 'R$ 300.000', '< 1 mês'],
    ['50.000', '2.500', 'R$ 50.000', 'R$ 600.000', '< 1 mês'],
]
t = Table(proj_data, colWidths=[3.5*cm, 3*cm, 3*cm, 3.5*cm, 2*cm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), ROXO),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, ROXO_CLARO]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('FONT', (0,1), (-1,-1), 'Helvetica', 9),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('TEXTCOLOR', (3,1), (3,-1), VERDE),
    ('FONTNAME', (3,1), (3,-1), 'Helvetica-Bold'),
    ('ALIGN', (1,0), (-1,-1), 'CENTER'),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t)
story.append(Paragraph('* Break-even considerando investimento inicial de R$5.000.', S['body']))

story.append(Spacer(1, 0.3*cm))

# Gráfico de barras
dados_bar  = [1000, 2000, 4000, 6000, 10000, 25000, 60000]
labels_bar = ['500v', '1Kv', '2Kv', '3Kv', '5Kv', '12.5Kv', '25Kv']
story.append(Paragraph('<b>Receita Anual por Volume de Vidas (R$)</b>', S['h3']))
story.append(BarChart(dados_bar, labels_bar, ROXO, width=W - 4*cm, height=130))

story.append(Spacer(1, 0.2*cm))
t7 = Table([[Paragraph(
    '📌 <b>Fontes adicionais de receita:</b> Cláusula de manutenção (R$1/func/mês × 48 meses) + '
    'Taxa de credenciamento por banco (única) + Suporte premium + Módulos avançados '
    '(eSocial, ISO 27001, Portabilidade).',
    S['body'])]], colWidths=[W - 4*cm])
t7.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), VERDE_CLARO),
    ('BOX', (0,0), (-1,-1), 1.5, VERDE),
    ('ROUNDEDCORNERS', [6]),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(t7)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 14 — SEGURANÇA
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(12, 'Segurança e Compliance'))
story.append(Spacer(1, 0.4*cm))

seg_itens = [
    ('🔐 JWT + OAuth2', 'Autenticação dual: JWT para usuários (RH, Admin) e OAuth2 client_credentials para bancos. Tokens com expiração configurável.'),
    ('🛡️ Helmet.js', 'Headers de segurança HTTP (XSS, CSRF, Clickjacking, HSTS). Cross-Origin Embedder Policy configurável.'),
    ('⏱️ Rate Limiting', 'Global: 500 req/15min. Login: 20 req/15min. Bank API: 120 req/min. OAuth2: 30 req/min.'),
    ('📋 Audit Log (LGPD)', 'Toda ação é registrada em logs_auditoria: usuário, IP, antes/depois, resultado. Rastreabilidade completa.'),
    ('🔒 Criptografia', 'Senhas com bcrypt (salt 10). Comprovantes com SHA-256. Chaves privadas de certificados criptografadas.'),
    ('🌐 CORS Configurável', 'Origin configurável por ambiente. Credentials habilitadas para sessões autenticadas.'),
    ('📁 ISO 27001', 'Módulo dedicado com controles de segurança mapeados, evidências e relatórios de conformidade.'),
    ('📜 Certificados Digitais', 'Suporte a e-CPF, e-CNPJ, SSL e Timestamp. Revogação, validade e algoritmo RSA-2048.'),
]

for titulo, desc in seg_itens:
    row = [[Paragraph(titulo, S['destaque']), Paragraph(desc, S['body'])]]
    t8 = Table(row, colWidths=[4*cm, 11*cm])
    t8.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CINZA_BG),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROUNDEDCORNERS', [4]),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(t8)
    story.append(Spacer(1, 3))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 15 — FAQ
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(13, 'Perguntas Frequentes (FAQ)'))
story.append(Spacer(1, 0.4*cm))

faqs = [
    ('O RH precisa pagar alguma coisa?',
     'Não. A estratégia Zero-Cost RH garante que prefeituras e órgãos públicos usam o sistema gratuitamente. '
     'A receita vem 100% dos bancos, via taxa por averbação.'),
    ('O banco paga mesmo que a averbação seja cancelada?',
     'Não. O billing só é disparado quando o status muda para APROVADA. '
     'Reservas canceladas, expiradas ou recusadas não geram cobrança.'),
    ('Como o banco sabe o saldo pré-pago restante?',
     'O admin pode consultar via dashboard "Créditos Pré-pagos". Em breve, '
     'o banco receberá webhook quando o saldo atingir 20% do pacote (configurável).'),
    ('Quantos bancos podem ser conectados simultaneamente?',
     'Ilimitado. Cada banco tem seu client_id OAuth2, seu ciclo de faturamento independente '
     'e sua própria tarifa negociada.'),
    ('É possível ter tarifas diferentes por convênio?',
     'Sim. A hierarquia é: banco×convênio específico → banco genérico → taxa padrão. '
     'Ex: BB na Prefeitura SP = R$15, BB na Prefeitura RJ = R$18, BB padrão = R$20.'),
    ('O comprovante SHA-256 tem validade jurídica?',
     'O hash SHA-256 funciona como prova de integridade. Para validade jurídica plena, '
     'recomenda-se assinar o comprovante com certificado ICP-Brasil (módulo Cert. Digital disponível).'),
    ('O sistema suporta portabilidade entre bancos?',
     'Sim. O módulo Portabilidade permite transferir contratos entre bancos com rastreio '
     'completo do histórico de taxas, saldo devedor e prazo restante.'),
    ('Qual o volume máximo de funcionários suportado?',
     'O SQLite em modo WAL suporta confortavelmente até ~100.000 funcionários. '
     'Para escala maior, a migração para PostgreSQL requer apenas trocar o driver.'),
]

for i, (pergunta, resp) in enumerate(faqs):
    inner = Table([[
        Table([[
            [Paragraph(f'Q{i+1:02d}', S['kpi_val'])],
        ]], colWidths=[1.2*cm], style=TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), AZUL_MUTED),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('ROUNDEDCORNERS', [4]),
        ])),
        Table([[
            [Paragraph(pergunta, S['destaque'])],
            [Paragraph(resp, S['body'])],
        ]], colWidths=[13*cm], style=TableStyle([
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('TOPPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ])),
    ]], colWidths=[1.5*cm, 13.5*cm])
    inner.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BRANCO if i%2==0 else CINZA_BG),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROUNDEDCORNERS', [4]),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(inner)
    story.append(Spacer(1, 4))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# PG 16 — PRÓXIMOS PASSOS
# ═══════════════════════════════════════════════════════
story.append(SectionHeader(14, 'Próximos Passos'))
story.append(Spacer(1, 0.4*cm))

story.append(Paragraph(
    'O MargemPRO v2.0 está <b>pronto para produção</b>. O roadmap abaixo detalha '
    'as etapas de implantação e as funcionalidades planejadas para as próximas versões.',
    S['body_j']))
story.append(Spacer(1, 0.4*cm))

road_data = [
    ['Fase', 'Ação', 'Prazo', 'Status'],
    ['Implantação', 'Credenciar primeiro banco parceiro (OAuth2)', '1 semana', 'Aguardando'],
    ['Implantação', 'Importar folha de pagamento real (CSV/TOTVS)', '1 semana', 'Aguardando'],
    ['Implantação', 'Treinar equipe RH no painel de reservas', '2 dias', 'Aguardando'],
    ['Receita', 'Definir tarifas por banco (painel Tarifas)', '1 dia', 'Aguardando'],
    ['Receita', 'Configurar cláusula de manutenção em contratos', '1 semana', 'Aguardando'],
    ['Receita', 'Primeiro fechamento de ciclo mensal', '30 dias', 'Aguardando'],
    ['v2.1', 'App mobile para funcionários consultarem margem', '60 dias', 'Planejado'],
    ['v2.1', 'Dashboard biometria + blockchain de comprovantes', '90 dias', 'Planejado'],
    ['v2.2', 'Auto-portabilidade inteligente (menor taxa)', '90 dias', 'Planejado'],
    ['v2.2', 'Integração eSocial completa (S-2200, S-2400)', '60 dias', 'Planejado'],
    ['v3.0', 'Multi-tenant SaaS (múltiplas prefeituras)', '6 meses', 'Roadmap'],
]
cores_status = {
    'Aguardando': colors.HexColor('#fef3c7'),
    'Planejado': colors.HexColor('#dbeafe'),
    'Roadmap': ROXO_CLARO,
}
t_road = Table(road_data, colWidths=[2.5*cm, 7.5*cm, 2.5*cm, 2.5*cm])
style_road = [
    ('BACKGROUND', (0,0), (-1,0), CINZA_ESC),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('FONT', (0,1), (-1,-1), 'Helvetica', 8.5),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('ALIGN', (2,0), (-1,-1), 'CENTER'),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]
# Colorir por fase
for i, row in enumerate(road_data[1:], 1):
    fase = row[0]
    cor = colors.HexColor('#f0fdf4') if fase == 'Implantação' else \
          colors.HexColor('#fefce8') if fase == 'Receita' else \
          AZUL_MUTED if fase == 'v2.1' else \
          ROXO_CLARO if fase == 'v2.2' else \
          colors.HexColor('#f8fafc')
    style_road.append(('BACKGROUND', (0,i), (0,i), cor))
t_road.setStyle(TableStyle(style_road))
story.append(t_road)

story.append(Spacer(1, 0.5*cm))

# Box de contato / CTA
t_cta = Table([[Paragraph(
    '🚀 <b>Para iniciar:</b> Acesse o sistema em produção, faça login com as credenciais demo '
    'e explore o painel de Faturamento. Para credenciar um banco real, acesse '
    '<b>Admin → Bancos → Credenciar</b> e configure o OAuth2 client. '
    'Qualquer dúvida, consulte o FAQ ou abra uma issue no repositório GitHub.',
    S['body'])]], colWidths=[W - 4*cm])
t_cta.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), AZUL_MUTED),
    ('BOX', (0,0), (-1,-1), 2, AZUL),
    ('ROUNDEDCORNERS', [8]),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('TOPPADDING', (0,0), (-1,-1), 12),
    ('BOTTOMPADDING', (0,0), (-1,-1), 12),
]))
story.append(t_cta)

story.append(Spacer(1, 0.3*cm))

# Credenciais demo
cred_data = [
    [Paragraph('<b>Credenciais Demo</b>', S['table_h']),
     Paragraph('<b>Email</b>', S['table_h']),
     Paragraph('<b>Senha</b>', S['table_h'])],
    ['🔑 Super Admin', 'admin@margempro.com.br', 'Admin@2024'],
    ['🏛️ RH / Prefeitura', 'rh@prefeitura.sp.gov.br', 'RH@12345'],
    ['🏦 Operador Banco', 'operador@bb.com.br', 'Banco@123'],
]
t_cred = Table(cred_data, colWidths=[3.5*cm, 6*cm, 5.5*cm])
t_cred.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), AZUL),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [BRANCO, AZUL_MUTED]),
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e8f0')),
    ('FONT', (0,0), (-1,0), 'Helvetica-Bold', 9),
    ('FONT', (0,1), (-1,-1), 'Helvetica', 9),
    ('FONT', (1,1), (2,-1), 'Courier', 9),
    ('TEXTCOLOR', (0,0), (-1,0), BRANCO),
    ('TEXTCOLOR', (0,1), (-1,-1), CINZA_MED),
    ('LEFTPADDING', (0,0), (-1,-1), 10),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [4]),
]))
story.append(t_cred)

# ─── Construção final ─────────────────────────────────────────────────────────
is_first_page = [True]

def on_page(canvas, doc):
    if doc.page == 1:
        build_capa(canvas, doc)
    else:
        build_page_header(canvas, doc)

doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print(f'PDF gerado: {OUTPUT}')
