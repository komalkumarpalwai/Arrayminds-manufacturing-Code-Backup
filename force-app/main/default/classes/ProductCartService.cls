public with sharing class ProductCartService {

    /* ================= DTO ================= */
    public class ProductDTO {
        @AuraEnabled public Id productId;
        @AuraEnabled public String name;
        @AuraEnabled public String productCode;
        @AuraEnabled public String imageUrl;
        @AuraEnabled public List<String> imageUrls;
        @AuraEnabled public Decimal unitPrice;
        @AuraEnabled public String currencyIsoCode;
        @AuraEnabled public String ProductFamily;
    }


/* ===== PRICEBOOK LIST ===== */
@AuraEnabled(cacheable=true)
public static List<Pricebook2> getPricebooks()
{
    return [
        SELECT Id, Name
        FROM Pricebook2
        WHERE IsActive = true
        ORDER BY Name
    ];
}

/* ===== PRODUCTS BASED ON PRICEBOOK + CURRENCY ===== */
@AuraEnabled(cacheable=true)
public static List<ProductDTO> getProductsByPricebook(
    Id pricebookId,
    String currencyIso
){
    List<ProductDTO> result = new List<ProductDTO>();
    List<PricebookEntry> pricebookEntries = [
        SELECT Id, Product2Id, Product2.Name, Product2.ProductCode,
               Product2.Family, UnitPrice, CurrencyIsoCode
        FROM PricebookEntry
        WHERE Pricebook2Id = :pricebookId
        AND CurrencyIsoCode = :currencyIso
        AND IsActive = true
    ];

    // Collect product IDs to fetch images
    Set<Id> productIds = new Set<Id>();
    for(PricebookEntry pbe : pricebookEntries) {
        productIds.add(pbe.Product2Id);
    }

    // Fetch ALL images for products (including all versions)
    Map<Id, List<Id>> productToDocList = new Map<Id, List<Id>>();
    for (ContentDocumentLink cdl : [
        SELECT LinkedEntityId, ContentDocumentId
        FROM ContentDocumentLink
        WHERE LinkedEntityId IN :productIds
        ORDER BY SystemModstamp DESC
    ]) {
        if (!productToDocList.containsKey(cdl.LinkedEntityId)) {
            productToDocList.put(cdl.LinkedEntityId, new List<Id>());
        }
        productToDocList.get(cdl.LinkedEntityId).add(cdl.ContentDocumentId);
    }

    // Fetch latest versions of each document
    Map<Id, ContentVersion> docToVersion = new Map<Id, ContentVersion>();
    Set<Id> allDocIds = new Set<Id>();
    for(List<Id> docIds : productToDocList.values()) {
        allDocIds.addAll(docIds);
    }
    
    if (!allDocIds.isEmpty()) {
        for (ContentVersion cv : [
            SELECT Id, ContentDocumentId
            FROM ContentVersion
            WHERE ContentDocumentId IN :allDocIds
            AND IsLatest = true
            ORDER BY CreatedDate DESC
        ]) {
            docToVersion.put(cv.ContentDocumentId, cv);
        }
    }

    // Build result DTOs
    for(PricebookEntry pbe : pricebookEntries){
        ProductDTO dto = new ProductDTO();
        dto.productId = pbe.Product2Id;
        dto.name = pbe.Product2.Name;
        dto.productCode = pbe.Product2.ProductCode;
        dto.ProductFamily = pbe.Product2.Family;
        dto.unitPrice = pbe.UnitPrice;
        dto.currencyIsoCode = pbe.CurrencyIsoCode;
        dto.imageUrls = new List<String>();

        // Fetch all image URLs for this product
        if(productToDocList.containsKey(pbe.Product2Id)){
            List<Id> docIds = productToDocList.get(pbe.Product2Id);
            for(Id docId : docIds) {
                if(docToVersion.containsKey(docId)){
                    String imgUrl = '/sfc/servlet.shepherd/version/download/' + docToVersion.get(docId).Id;
                    dto.imageUrls.add(imgUrl);
                }
            }
        }

        // Set primary image URL (latest/first image)
        if(dto.imageUrls.size() > 0) {
            dto.imageUrl = dto.imageUrls.get(0);
        }

        result.add(dto);
    }
    return result;
}

    /* ================= FETCH PRODUCTS ================= */
    @AuraEnabled(cacheable=true)
    public static List<ProductDTO> getProducts(Id parentId)
    {
        List<Product2> products = [
            SELECT Id, Name, ProductCode
            FROM Product2
            WHERE IsActive = true
            ORDER BY Name
        ];

        Set<Id> productIds = new Set<Id>();
        for(Product2 p : products) productIds.add(p.Id);

        /* ===== STANDARD PRICEBOOK ===== */
        Id stdPb = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;

        Map<Id, PricebookEntry> priceMap = new Map<Id, PricebookEntry>();
        for (PricebookEntry pbe : [
            SELECT Product2Id, UnitPrice, CurrencyIsoCode
            FROM PricebookEntry
            WHERE Pricebook2Id = :stdPb
            AND Product2Id IN :productIds
            AND IsActive = true
        ]) {
            priceMap.put(pbe.Product2Id, pbe);
        }

        /* ===== Images ===== */
        Map<Id, Id> productToDoc = new Map<Id, Id>();
        for (ContentDocumentLink cdl : [
            SELECT LinkedEntityId, ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :productIds
        ]) {
            if (!productToDoc.containsKey(cdl.LinkedEntityId)) {
                productToDoc.put(cdl.LinkedEntityId, cdl.ContentDocumentId);
            }
        }

        Map<Id, ContentVersion> docToVersion = new Map<Id, ContentVersion>();
        if (!productToDoc.isEmpty()) {
            for (ContentVersion cv : [
                SELECT Id, ContentDocumentId
                FROM ContentVersion
                WHERE ContentDocumentId IN :productToDoc.values()
                AND IsLatest = true
            ]) {
                docToVersion.put(cv.ContentDocumentId, cv);
            }
        }

        List<ProductDTO> result = new List<ProductDTO>();
        for(Product2 p : products)
        {
            if(!priceMap.containsKey(p.Id)) continue;

            ProductDTO dto = new ProductDTO();
            dto.productId = p.Id;
            dto.name = p.Name;
            dto.productCode = p.ProductCode;
            dto.unitPrice = priceMap.get(p.Id).UnitPrice;
            dto.currencyIsoCode = priceMap.get(p.Id).CurrencyIsoCode;

            if(productToDoc.containsKey(p.Id))
            {
                Id docId = productToDoc.get(p.Id);
                if(docToVersion.containsKey(docId))
                {
                    dto.imageUrl =
                        '/sfc/servlet.shepherd/version/download/' +
                        docToVersion.get(docId).Id;
                }
            }
            result.add(dto);
        }
        return result;
    }

    /* ================= GENERIC INSERT ================= */
    // @AuraEnabled
    // public static void addProducts(Id parentId, List<Map<String,Object>> lines)
    // {
    //     System.debug('===== START addProducts =====');
    //     System.debug('Parent Id: ' + parentId);
    //     System.debug('Incoming Lines: ' + lines);

    //     String parentObj = parentId.getSObjectType().getDescribe().getName();
    //     System.debug('Parent Object: ' + parentObj);

    //     Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
    //     System.debug('Standard Pricebook: ' + stdPbId);

    //     Id pricebookId;

    //     /* ===== GET PARENT PRICEBOOK ===== */
    //     if(parentObj == 'Opportunity'){
    //         Opportunity o = [SELECT Pricebook2Id FROM Opportunity WHERE Id=:parentId];
    //         if(o.Pricebook2Id == null){
    //             o.Pricebook2Id = stdPbId;
    //             update o;
    //             System.debug('Assigned Standard Pricebook to Opportunity');
    //         }
    //         pricebookId = o.Pricebook2Id;
    //     }
    //     else if(parentObj == 'Quote'){
    //         Quote q = [SELECT Pricebook2Id FROM Quote WHERE Id=:parentId];
    //         if(q.Pricebook2Id == null){
    //             q.Pricebook2Id = stdPbId;
    //             update q;
    //             System.debug('Assigned Standard Pricebook to Quote');
    //         }
    //         pricebookId = q.Pricebook2Id;
    //     }
    //     else if(parentObj == 'Order'){
    //         Order o = [SELECT Pricebook2Id FROM Order WHERE Id=:parentId];
    //         if(o.Pricebook2Id == null){
    //             o.Pricebook2Id = stdPbId;
    //             update o;
    //             System.debug('Assigned Standard Pricebook to Order');
    //         }
    //         pricebookId = o.Pricebook2Id;
    //     }

    //     System.debug('Using Pricebook: ' + pricebookId);

    //     /* ===== COLLECT PRODUCTS ===== */
    //     Set<Id> productIds = new Set<Id>();
    //     for(Map<String,Object> m : lines)
    //         productIds.add((Id)m.get('Product2Id'));

    //     System.debug('Product Ids: ' + productIds);

    //     /* ===== FIND PRICEBOOK ENTRIES ===== */
    //     Map<Id,PricebookEntry> pbeMap = new Map<Id,PricebookEntry>();

    //     for(PricebookEntry pbe : [
    //         SELECT Id, Product2Id
    //         FROM PricebookEntry
    //         WHERE Product2Id IN :productIds
    //         AND Pricebook2Id = :pricebookId
    //         AND IsActive = true
    //     ]){
    //         pbeMap.put(pbe.Product2Id, pbe);
    //     }

    //     System.debug('PBEs from Parent Pricebook: ' + pbeMap);

    //     /* ===== FALLBACK TO STANDARD PRICEBOOK ===== */
    //     for(PricebookEntry pbe : [
    //         SELECT Id, Product2Id
    //         FROM PricebookEntry
    //         WHERE Product2Id IN :productIds
    //         AND Pricebook2Id = :stdPbId
    //         AND IsActive = true
    //     ]){
    //         if(!pbeMap.containsKey(pbe.Product2Id)){
    //             pbeMap.put(pbe.Product2Id, pbe);
    //             System.debug('Fallback PBE used for Product: ' + pbe.Product2Id);
    //         }
    //     }

    //     System.debug('Final PBE Map: ' + pbeMap);

    //     /* ===== INSERT LINES ===== */
    //     List<SObject> insertList = new List<SObject>();

    //     for(Map<String,Object> m : lines)
    //     {
    //         Id productId = (Id)m.get('Product2Id');
    //         Decimal qty = (Decimal)m.get('Quantity');
    //         Decimal price = (Decimal)m.get('UnitPrice');

    //         if(!pbeMap.containsKey(productId)){
    //             System.debug('No PricebookEntry found for Product: ' + productId);
    //             continue;
    //         }
    //         String parentCurrency;
    //         if(parentObj == 'Opportunity'){
    //             OpportunityLineItem oli = new OpportunityLineItem();
    //             oli.OpportunityId = parentId;
    //             oli.PricebookEntryId = pbeMap.get(productId).Id;
    //             oli.Quantity = qty;
    //             oli.UnitPrice = price;
    //             insertList.add(oli);
    //         }
    //         else if(parentObj == 'Quote'){
    //             QuoteLineItem qli = new QuoteLineItem();
    //             qli.QuoteId = parentId;
    //             qli.PricebookEntryId = pbeMap.get(productId).Id;
    //             qli.Quantity = qty;
    //             qli.UnitPrice = price;
    //             insertList.add(qli);
    //         }
    //         else if(parentObj == 'Order'){
    //             OrderItem oi = new OrderItem();
    //             oi.OrderId = parentId;
    //             oi.PricebookEntryId = pbeMap.get(productId).Id;
    //             oi.Quantity = qty;
    //             oi.UnitPrice = price;
    //             insertList.add(oi);
    //         }
    //     }

    //     System.debug('Insert List Size: ' + insertList.size());
    //     System.debug('Insert List Data: ' + insertList);

    //     insert insertList;

    //     System.debug('===== END addProducts =====');
    // }
    @AuraEnabled
    public static void addProducts(Id parentId, List<Map<String,Object>> lines)
    {
        String parentObj = parentId.getSObjectType().getDescribe().getName();

        Id pricebookId;
        String parentCurrency;

        /* ===== GET PARENT PRICEBOOK + CURRENCY ===== */
        if(parentObj == 'Opportunity'){
            Opportunity o = [
                SELECT Pricebook2Id, CurrencyIsoCode
                FROM Opportunity WHERE Id=:parentId
            ];
            pricebookId = o.Pricebook2Id;
            parentCurrency = o.CurrencyIsoCode;
        }
        else if(parentObj == 'Quote'){
            Quote q = [
                SELECT Pricebook2Id, CurrencyIsoCode
                FROM Quote WHERE Id=:parentId
            ];
            pricebookId = q.Pricebook2Id;
            parentCurrency = q.CurrencyIsoCode;
        }
        else if(parentObj == 'Order'){
            Order o = [
                SELECT Pricebook2Id, CurrencyIsoCode
                FROM Order WHERE Id=:parentId
            ];
            pricebookId = o.Pricebook2Id;
            parentCurrency = o.CurrencyIsoCode;
        }

        /* ===== STANDARD PRICEBOOK ===== */
        Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard=true LIMIT 1].Id;

        /* ===== COLLECT PRODUCTS ===== */
        Set<Id> productIds = new Set<Id>();
        for(Map<String,Object> m : lines)
            productIds.add((Id)m.get('Product2Id'));

        /* ===== FIND PBEs (MATCHING PRICEBOOK + CURRENCY) ===== */
        Map<Id,PricebookEntry> pbeMap = new Map<Id,PricebookEntry>();

        for(PricebookEntry pbe : [
            SELECT Id, Product2Id
            FROM PricebookEntry
            WHERE Product2Id IN :productIds
            AND Pricebook2Id = :pricebookId
            AND CurrencyIsoCode = :parentCurrency
            AND IsActive = true
        ]){
            pbeMap.put(pbe.Product2Id, pbe);
        }

        /* ===== FALLBACK TO STANDARD PRICEBOOK (SAME CURRENCY) ===== */
        for(PricebookEntry pbe : [
            SELECT Id, Product2Id
            FROM PricebookEntry
            WHERE Product2Id IN :productIds
            AND Pricebook2Id = :stdPbId
            AND CurrencyIsoCode = :parentCurrency
            AND IsActive = true
        ]){
            if(!pbeMap.containsKey(pbe.Product2Id))
                pbeMap.put(pbe.Product2Id, pbe);
        }

        /* ===== INSERT LINES ===== */
        List<SObject> insertList = new List<SObject>();

        for(Map<String,Object> m : lines)
        {
            Id productId = (Id)m.get('Product2Id');
            Decimal qty = (Decimal)m.get('Quantity');
            Decimal price = (Decimal)m.get('UnitPrice');

            if(!pbeMap.containsKey(productId)) continue;

            if(parentObj == 'Opportunity'){
                OpportunityLineItem oli = new OpportunityLineItem();
                oli.OpportunityId = parentId;
                oli.PricebookEntryId = pbeMap.get(productId).Id;
                oli.Quantity = qty;
                oli.UnitPrice = price;
                insertList.add(oli);
            }
            else if(parentObj == 'Quote'){
                QuoteLineItem qli = new QuoteLineItem();
                qli.QuoteId = parentId;
                qli.PricebookEntryId = pbeMap.get(productId).Id;
                qli.Quantity = qty;
                qli.UnitPrice = price;
                insertList.add(qli);
            }
            else if(parentObj == 'Order'){
                OrderItem oi = new OrderItem();
                oi.OrderId = parentId;
                oi.PricebookEntryId = pbeMap.get(productId).Id;
                oi.Quantity = qty;
                oi.UnitPrice = price;
                insertList.add(oi);
            }
        }

        if(!insertList.isEmpty())
            insert insertList;
    }

    @AuraEnabled
    public static void updateParentPricebook(Id parentId, Id pricebookId)
    {
        String objName = parentId.getSObjectType().getDescribe().getName();

        if(objName == 'Opportunity'){
            update new Opportunity(
                Id = parentId,
                Pricebook2Id = pricebookId
            );
        }
        else if(objName == 'Quote'){
            update new Quote(
                Id = parentId,
                Pricebook2Id = pricebookId
            );
        }
        else if(objName == 'Order'){
            update new Order(
                Id = parentId,
                Pricebook2Id = pricebookId
            );
        }
    }

}