/**
 * Gerenciador de Produtos e Catálogo da Loja (Store Products) para o Projeto Feito no Seridó
 * Responsável por gerenciar o catálogo de produtos, busca em tempo real, validação de formulários
 * de cadastro de novas peças, renderização dinâmica na interface e sincronização com o Supabase.
 */

import { CLOUD_PRODUCTS_KEY, PRODUCTS_KEY, formatBRL, getCloudClient, isUuid, parsePrice, productId, readList } from "./store-state-utils.js";

export function createProductStore({ notifyLocal }) {
  let publishedProducts = [];

  function setCatalogStatus(message) {
    const status = document.getElementById("catalog-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("hidden", !message);
  }

  function makeCatalogProductCard(product) {
    const card = document.createElement("article");
    card.dataset.localProduct = `cloud-${product.product_id}`;
    card.dataset.productId = product.product_id;
    card.className = "group bg-surface-container-lowest rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden relative";

    const imagePlaceholder = document.createElement("div");
    imagePlaceholder.className = "relative w-full aspect-[4/3] bg-surface-container-low flex items-center justify-center text-outline";
    const imageIcon = document.createElement("span");
    imageIcon.className = "material-symbols-outlined text-[48px]";
    imageIcon.textContent = "storefront";
    imagePlaceholder.appendChild(imageIcon);

    const content = document.createElement("div");
    content.className = "p-4 flex-1 flex flex-col justify-between space-y-3";

    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "font-headline-sm text-[17px] text-on-surface font-semibold leading-snug";
    title.textContent = product.name;
    const description = document.createElement("p");
    description.className = "font-body-sm text-body-sm text-on-surface-variant mt-2";
    description.textContent = product.story || "Produto publicado no catálogo do Seridó.";
    details.append(title, description);

    const footer = document.createElement("div");
    footer.className = "pt-2 border-t border-surface-container flex items-end justify-between";
    const price = document.createElement("span");
    price.className = "font-headline-sm text-headline-sm text-primary font-bold";
    price.textContent = formatBRL(product.price);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "w-10 h-10 rounded-xl bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed";
    add.setAttribute("aria-label", product.stock > 0 ? "Adicionar à Cesta" : "Produto sem estoque");
    add.disabled = product.stock <= 0;
    add.textContent = product.stock > 0 ? "+" : "—";
    footer.append(price, add);

    content.append(details, footer);
    card.append(imagePlaceholder, content);
    return card;
  }
  
  /**
   * Atualiza os contadores e textos de resumo de produtos visíveis e carregados no catálogo.
   */
  function updateCatalogCount() {
    const grid = document.getElementById("product-grid");
    if (!grid) return;
    
    const cards = [...grid.querySelectorAll(":scope > article")];
    const visible = cards.filter((card) => !card.classList.contains("hidden"));
    
    // Atualiza o texto descritivo de contagem de exibição (ex: "Mostrando X de Y produtos carregados")
    const countSummary = [...document.querySelectorAll("span")].find((element) => element.textContent.includes("Mostrando"));
    if (countSummary) {
      countSummary.replaceChildren("Mostrando ");
      const visibleCount = document.createElement("strong");
      visibleCount.className = "text-on-surface font-bold";
      visibleCount.textContent = String(visible.length);
      
      const totalCount = document.createElement("strong");
      totalCount.className = "text-on-surface font-bold";
      totalCount.textContent = String(cards.length);
      
      countSummary.append(visibleCount, " de ", totalCount, " produtos carregados");
    }
    
    // Atualiza o contador geral de criações no cabeçalho ou filtros
    const catalogCount = [...document.querySelectorAll("span")].find((element) => /\b\d+ Criações\b/.test(element.textContent));
    if (catalogCount) catalogCount.textContent = `${cards.length} produtos carregados`;
  }

  /**
   * Configura a barra de busca dinâmica no catálogo para filtrar produtos em tempo real conforme a digitação.
   */
  function setupCatalogSearch() {
    const search = document.getElementById("catalog-search");
    const grid = document.getElementById("product-grid");
    if (!search || !grid) return;
    
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase("pt-BR");
      grid.querySelectorAll(":scope > article").forEach((card) => {
        card.classList.toggle("hidden", !card.textContent.toLocaleLowerCase("pt-BR").includes(query));
      });
      updateCatalogCount();
    });
  }

  /**
   * Coleta, valida e formata os dados inseridos no formulário de cadastro/criação de um novo produto.
   * @returns {object|null} Objeto contendo os dados estruturados do produto ou null se houverem campos inválidos.
   */
  function productFormData() {
    const name = document.getElementById("item-name")?.value.trim() || "";
    const price = parsePrice(document.getElementById("price-input")?.value);
    const dimensions = {
      length_cm: Number(document.getElementById("dim-comprimento")?.value || 0),
      width_cm: Number(document.getElementById("dim-largura")?.value || 0),
      weight_g: Number(document.getElementById("dim-peso")?.value || 0),
    };
    
    // Valida se os campos obrigatórios foram preenchidos corretamente
    if (!name || price <= 0 || Object.values(dimensions).some((value) => value <= 0)) {
      notifyLocal("Preencha nome, preço, peso e dimensões válidos antes de salvar.");
      return null;
    }
    
    return {
      id: `local-${crypto.randomUUID()}`,
      slug: `${productId(name)}-${crypto.randomUUID().slice(0, 8)}`,
      name,
      price,
      story: document.getElementById("item-story")?.value.trim() || "",
      stock: Number(document.getElementById("qtd-estoque")?.value || 1),
      availability: document.querySelector('input[name="disponibilidade"]:checked')?.id || "disp-pronta",
      dimensions,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Renderiza na tela os produtos locais (armazenados no navegador) e os vindos da nuvem.
   * Cria dinamicamente os elementos HTML para cada card de produto na grade e no painel de produtores.
   */
  function renderLocalProducts() {
    const grid = document.getElementById("product-grid");
    const isCatalog = Boolean(grid && document.getElementById("catalog-search"));
    const products = isCatalog ? [] : [...readList(CLOUD_PRODUCTS_KEY, []), ...readList(PRODUCTS_KEY, [])];
    
    if (isCatalog) {
      grid.querySelectorAll(":scope > article").forEach((card) => card.remove());
      publishedProducts
        .filter((product) => isUuid(product.product_id))
        .forEach((product) => grid.appendChild(makeCatalogProductCard(product)));
      updateCatalogCount();
      return;
    }

    if (grid && location.pathname.includes("painel_produtores")) {
      // Remove produtos locais antigos da exibição para evitar duplicação
      grid.querySelectorAll("[data-local-product]").forEach((card) => card.remove());
      
      // Cria e insere o card HTML para cada produto na grade do catálogo
      products.forEach((product) => {
        const card = document.createElement("article");
        card.dataset.localProduct = product.id;
        if (isUuid(product.product_id)) card.dataset.productId = product.product_id;
        card.className = "flex flex-col gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-sm";
        
        const title = document.createElement("h3");
        title.className = "font-headline-sm text-on-surface";
        title.textContent = product.name;
        
        const description = document.createElement("p");
        description.className = "text-sm text-on-surface-variant";
        description.textContent = product.story || "Peça artesanal cadastrada neste navegador.";
        
        const price = document.createElement("p");
        price.className = "font-bold text-primary";
        price.textContent = formatBRL(product.price);
        
        const favorite = document.createElement("button");
        favorite.type = "button";
        favorite.className = "btn-heart self-start text-primary";
        favorite.dataset.product = product.name;
        favorite.dataset.localFavorite = "true";
        favorite.setAttribute("aria-label", `Favoritar ${product.name}`);
        
        const heart = document.createElement("span");
        heart.className = "material-symbols-outlined";
        heart.textContent = "favorite_border";
        favorite.appendChild(heart);
        
        const add = document.createElement("button");
        add.type = "button";
        add.className = "w-10 h-10 rounded-lg bg-primary text-on-primary";
        add.setAttribute("aria-label", "Adicionar à Cesta");
        add.textContent = "+";
        
        card.append(title, description, price, favorite, add);
        grid.appendChild(card);
      });
    }

    // Se estiver no painel de produtores, cria uma seção dedicada listando os produtos salvos localmente
    if (location.pathname.includes("painel_produtores")) {
      const main = document.querySelector("main");
      if (!main || document.getElementById("local-products-panel")) return;
      
      const section = document.createElement("section");
      section.id = "local-products-panel";
      section.className = "mx-auto my-6 w-full max-w-7xl px-margin lg:px-margin-desktop";
      
      const heading = document.createElement("h2");
      heading.className = "mb-3 font-headline-sm text-on-surface";
      heading.textContent = `Produtos cadastrados neste navegador (${products.length})`;
      section.appendChild(heading);
      
      products.forEach((product) => {
        const item = document.createElement("p");
        item.className = "border-b border-surface-container py-2 text-sm text-on-surface";
        item.textContent = `${product.name} · ${formatBRL(product.price)} · ${product.stock} em estoque`;
        section.appendChild(item);
      });
      
      if (!products.length) section.append("Nenhum produto cadastrado neste navegador.");
      main.prepend(section);
    }
    
    if (grid) updateCatalogCount();
  }

  /**
   * Carrega os produtos diretamente da tabela de produtos do banco de dados do Supabase.
   * Filtra por proprietário se estiver no painel de produtores ou apenas itens publicados para o público geral.
   */
  async function loadCloudProducts() {
    const isCatalog = Boolean(document.getElementById("catalog-search"));
    if (isCatalog) setCatalogStatus("Carregando produtos publicados...");

    try {
      const client = await getCloudClient();
      if (!client) {
        if (isCatalog) {
          publishedProducts = [];
          renderLocalProducts();
          setCatalogStatus("Catálogo temporariamente indisponível. Tente novamente mais tarde.");
        }
        return;
      }

      let query = client.from("products").select("id, slug, name, description, price, stock, status");
      if (location.pathname.includes("painel_produtores")) {
        const { data: { user } } = await client.auth.getUser();
        query = user ? query.eq("owner_id", user.id) : query.eq("status", "published");
      } else {
        query = query.eq("status", "published");
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      const products = (data || [])
        .filter((item) => {
          const price = Number(item.price);
          const stock = Number(item.stock);
          return isUuid(item.id)
            && (!isCatalog || item.status === "published")
            && Number.isFinite(price)
            && price > 0
            && Number.isInteger(stock)
            && stock >= 0;
        })
        .map((item) => ({
          id: `cloud-${item.id}`,
          product_id: item.id,
          slug: item.slug,
          name: item.name,
          story: item.description,
          price: Number(item.price),
          stock: Number(item.stock),
        }));

      localStorage.setItem(CLOUD_PRODUCTS_KEY, JSON.stringify(products));
      if (isCatalog) {
        publishedProducts = products;
        renderLocalProducts();
        setCatalogStatus(products.length ? "" : "Nenhum produto publicado disponível no momento.");
      } else {
        renderLocalProducts();
      }
    } catch (error) {
      if (isCatalog) {
        publishedProducts = [];
        renderLocalProducts();
        setCatalogStatus("Catálogo temporariamente indisponível. Tente novamente mais tarde.");
      }
      throw error;
    }
  }

  return { updateCatalogCount, setupCatalogSearch, productFormData, renderLocalProducts, loadCloudProducts };
}