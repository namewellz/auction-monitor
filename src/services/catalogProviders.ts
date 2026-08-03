import type { AppConfig } from '../config.js';
import type { CatalogProvider } from '../scrapers/base/catalogProvider.js';
import { LeiloCatalogScraper } from '../scrapers/providers/leiloCatalog.js';
import { VipLeiloesCatalogProvider } from '../scrapers/providers/vipLeiloesCatalog.js';
import type { VipLeiloesClient } from '../scrapers/providers/vipLeiloesClient.js';
import { FrancoRealEstateCatalogProvider } from '../scrapers/providers/francoRealEstateCatalog.js';
import { AlessandroTeixeiraRealEstateCatalogProvider } from '../scrapers/providers/alessandroTeixeiraRealEstateCatalog.js';
import { AlvaroRealEstateCatalogProvider } from '../scrapers/providers/alvaroRealEstateCatalog.js';
import { BrunoRealEstateCatalogProvider } from '../scrapers/providers/brunoRealEstateCatalog.js';
import { CalilRealEstateCatalogProvider } from '../scrapers/providers/calilRealEstateCatalog.js';
import { CapitalValorRealEstateCatalogProvider } from '../scrapers/providers/capitalValorRealEstateCatalog.js';
import { D1LanceRealEstateCatalogProvider } from '../scrapers/providers/d1LanceRealEstateCatalog.js';
import { CarloFerrariRealEstateCatalogProvider,CidaFixerRealEstateCatalogProvider,DaSilvaRealEstateCatalogProvider,DoLeiloesRealEstateCatalogProvider } from '../scrapers/providers/vlanceRealEstateCatalog.js';
import { SuperbidCatalogProvider } from '../scrapers/providers/superbidCatalog.js';
import { AkimotoRealEstateCatalogProvider,AlessandraRealEstateCatalogProvider,DeoniziaRealEstateCatalogProvider,
  FranciscoFreitasRealEstateCatalogProvider,GiordanoRealEstateCatalogProvider,HdRealEstateCatalogProvider,
  JrRealEstateCatalogProvider,RioRealEstateCatalogProvider,ThaisTeixeiraRealEstateCatalogProvider,
  RigolonRealEstateCatalogProvider,LeiloesJudiciaisBahiaRealEstateCatalogProvider,FabioRealEstateCatalogProvider,
  GalvaniRealEstateCatalogProvider,JoseRodovalhoRealEstateCatalogProvider,RosiOliveiraRealEstateCatalogProvider,
  FidelisRealEstateCatalogProvider,GilsonRealEstateCatalogProvider,JdRealEstateCatalogProvider,
  MariaFixerRealEstateCatalogProvider,VerdeAmareloRealEstateCatalogProvider,FabioBarbosaRealEstateCatalogProvider,
  ZanoniRealEstateCatalogProvider,PlanaltoRealEstateCatalogProvider,CentroOesteRealEstateCatalogProvider,
  DiasRealEstateCatalogProvider,MatoGrossoRealEstateCatalogProvider,VerriRealEstateCatalogProvider,
} from '../scrapers/providers/leiloesJudiciaisRealEstateCatalog.js';
import { SuporteLeiloesRealEstateCatalogProvider } from '../scrapers/providers/suporteLeiloesRealEstateCatalog.js';
import { suporteLeiloesDefinitions } from '../scrapers/providers/suporteLeiloesRealEstate.js';
import { MilanPageClient,MilanRealEstateCatalogProvider } from '../scrapers/providers/milanRealEstateCatalog.js';
import { SatoRealEstateCatalogProvider } from '../scrapers/providers/satoRealEstateCatalog.js';
import { LeiloeiroPublicoRealEstateCatalogProvider } from '../scrapers/providers/leiloeiroPublicoRealEstateCatalog.js';
import { InsigneRealEstateCatalogProvider } from '../scrapers/providers/insigneRealEstateCatalog.js';
import { MegaRealEstateCatalogProvider } from '../scrapers/providers/megaRealEstateCatalog.js';
import { PortalZukClient,PortalZukRealEstateCatalogProvider } from '../scrapers/providers/portalZukRealEstateCatalog.js';

export function createCatalogProviders(config: AppConfig, vipClient: VipLeiloesClient): CatalogProvider[] {
  return [
    new LeiloCatalogScraper(config.leiloApiUrl,'Carros'),new LeiloCatalogScraper(config.leiloApiUrl,'Motos'),
    new LeiloCatalogScraper(config.leiloApiUrl,'Pesados'),new VipLeiloesCatalogProvider(vipClient,'Seminovos'),
    new VipLeiloesCatalogProvider(vipClient,'Usados'),new VipLeiloesCatalogProvider(vipClient,'Motos'),
    new VipLeiloesCatalogProvider(vipClient,'Pesados'),new FrancoRealEstateCatalogProvider(config.francoRequestIntervalMs),
    new AlessandroTeixeiraRealEstateCatalogProvider(config.alessandroRequestIntervalMs),
    new AlvaroRealEstateCatalogProvider(config.alvaroRequestIntervalMs),new BrunoRealEstateCatalogProvider(config.brunoRequestIntervalMs),
    new CalilRealEstateCatalogProvider(config.calilRequestIntervalMs),new CapitalValorRealEstateCatalogProvider(config.capitalValorRequestIntervalMs),
    new D1LanceRealEstateCatalogProvider(config.d1LanceRequestIntervalMs),new CarloFerrariRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new DaSilvaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new CidaFixerRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new DoLeiloesRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new AkimotoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new AlessandraRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new DeoniziaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new JrRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new GiordanoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new FranciscoFreitasRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new RioRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new HdRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new ThaisTeixeiraRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new RigolonRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new LeiloesJudiciaisBahiaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new FabioRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new GalvaniRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new JoseRodovalhoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new RosiOliveiraRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new FidelisRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new GilsonRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new JdRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new MariaFixerRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new VerdeAmareloRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new FabioBarbosaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new ZanoniRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new PlanaltoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new CentroOesteRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new DiasRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new MatoGrossoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new VerriRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new InsigneRealEstateCatalogProvider(config.vlanceRequestIntervalMs),new LeiloeiroPublicoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new SatoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    ...suporteLeiloesDefinitions.map((definition)=>new SuporteLeiloesRealEstateCatalogProvider(definition,config.vlanceRequestIntervalMs)),
    new MilanRealEstateCatalogProvider(config.milanRequestIntervalMs,new MilanPageClient(config.milanFlareSolverrUrl)),
    new MegaRealEstateCatalogProvider(config.megaRequestIntervalMs),
    new PortalZukRealEstateCatalogProvider(config.portalZukRequestIntervalMs,config.portalZukPageIntervalMs,
      new PortalZukClient(config.portalZukFlareSolverrUrl)),
    new SuperbidCatalogProvider(config.superbidCatalogPageSize,config.superbidRequestIntervalMs,config.superbidCatalogMaxOffers),
  ];
}

export function catalogSites(providers: CatalogProvider[]): string[] {
  return [...new Set(providers.map((provider)=>provider.site))].sort();
}
